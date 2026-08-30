import { existsSync } from 'fs';
import { findTab, type ITabLocation } from '@/lib/tab-location';
import { getProvider, getProviderByPanelType, type IAgentProvider } from '@/lib/providers';
import { getSessionPanePid } from '@/lib/tmux';
import { isAllowedJsonlPath } from '@/lib/path-validation';
import { getStatusManager } from '@/lib/status-manager';
import {
  readProviderTimelineUntil,
  resolveProviderJsonlPath,
} from '@/lib/provider-timeline-reader';
import type { ITimelineAssistantMessage, ITimelineEntry } from '@/types/timeline';
import type { IClientTabStatusEntry } from '@/types/status';

const MAX_RESULT_TIMELINE_ENTRIES = 512;

export type TTabAgentResultStatus =
  | 'completed'
  | 'not-ready'
  | 'interrupted'
  | 'not-applicable'
  | 'unavailable';

export type TTabAgentResultReason =
  | 'non-agent-tab'
  | 'agent-session-id-unavailable'
  | 'jsonl-unavailable'
  | 'jsonl-path-not-allowed'
  | 'assistant-response-unavailable'
  | 'turn-interrupted';

export interface ITabAgentResult {
  tabId: string;
  workspaceId: string;
  panelType: string;
  agentProviderId: string | null;
  agentSessionId: string | null;
  status: TTabAgentResultStatus;
  reason: TTabAgentResultReason | null;
  text: string | null;
  completed: boolean;
  timestamp: number | null;
  completionTimestamp: number | null;
  interrupted: boolean;
}

export interface ITabAgentResultDependencies {
  findTab: typeof findTab;
  getLiveStatus: (tabId: string) => IClientTabStatusEntry | null;
  getProvider: typeof getProvider;
  getProviderByPanelType: typeof getProviderByPanelType;
  getSessionPanePid: typeof getSessionPanePid;
  existsSync: typeof existsSync;
  isAllowedJsonlPath: typeof isAllowedJsonlPath;
  readProviderTimelineUntil: typeof readProviderTimelineUntil;
  resolveProviderJsonlPath: typeof resolveProviderJsonlPath;
}

const defaultDependencies: ITabAgentResultDependencies = {
  findTab,
  getLiveStatus: (tabId) => getStatusManager().getForClient(tabId),
  getProvider,
  getProviderByPanelType,
  getSessionPanePid,
  existsSync,
  isAllowedJsonlPath,
  readProviderTimelineUntil,
  resolveProviderJsonlPath,
};

const unavailableResult = (
  found: ITabLocation,
  provider: IAgentProvider | null,
  status: Exclude<TTabAgentResultStatus, 'completed'>,
  reason: TTabAgentResultReason,
  agentSessionId: string | null = null,
  interrupted = false,
): ITabAgentResult => ({
  tabId: found.tab.id,
  workspaceId: found.workspaceId,
  panelType: found.tab.panelType ?? 'terminal',
  agentProviderId: provider?.id ?? null,
  agentSessionId,
  status,
  reason,
  text: null,
  completed: false,
  timestamp: null,
  completionTimestamp: null,
  interrupted,
});

interface ICompletedAssistantResponse {
  text: string;
  timestamp: number;
  completionTimestamp: number;
}

const extractLatestCompletedAssistantResponse = (
  entries: ITimelineEntry[],
): { response: ICompletedAssistantResponse | null; interrupted: boolean } => {
  let pending: ITimelineAssistantMessage | null = null;
  let pendingText = '';
  let completed: ICompletedAssistantResponse | null = null;
  let completedAtIndex: number | null = null;
  let latestInterruptIndex: number | null = null;

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry.type === 'user-message') {
      pending = null;
      pendingText = '';
      continue;
    }
    if (entry.type === 'assistant-message') {
      if (pending?.timestamp === entry.timestamp) {
        pendingText = `${pendingText}\n\n${entry.markdown}`;
      } else {
        pending = entry;
        pendingText = entry.markdown;
      }
      if (entry.stopReason === 'end_turn') {
        completed = {
          text: pendingText,
          timestamp: pending.timestamp,
          completionTimestamp: entry.timestamp,
        };
        completedAtIndex = index;
        pending = null;
        pendingText = '';
      }
      continue;
    }
    if (entry.type === 'turn-end') {
      if (pending) {
        completed = {
          text: pendingText,
          timestamp: pending.timestamp,
          completionTimestamp: entry.timestamp,
        };
        completedAtIndex = index;
      }
      pending = null;
      pendingText = '';
      continue;
    }
    if (entry.type === 'interrupt') {
      latestInterruptIndex = index;
      pending = null;
      pendingText = '';
    }
  }

  return {
    response: completed,
    interrupted: latestInterruptIndex !== null
      && (completedAtIndex === null || latestInterruptIndex > completedAtIndex),
  };
};

export const readTabAgentResult = async (
  workspaceId: string,
  tabId: string,
  dependencies: ITabAgentResultDependencies = defaultDependencies,
): Promise<ITabAgentResult | null> => {
  const found = await dependencies.findTab(workspaceId, tabId);
  if (!found) return null;

  const panelType = found.tab.panelType ?? 'terminal';
  const persistedProvider = dependencies.getProviderByPanelType(panelType);
  if (!persistedProvider) {
    return unavailableResult(found, null, 'not-applicable', 'non-agent-tab');
  }

  const liveStatus = dependencies.getLiveStatus(tabId);
  const liveProvider = liveStatus?.agentProviderId
    ? dependencies.getProvider(liveStatus.agentProviderId)
    : null;
  const hasMatchingLiveIdentity = liveStatus?.workspaceId === workspaceId
    && (liveStatus.panelType ?? 'terminal') === panelType
    && liveProvider?.panelType === panelType;
  const provider = hasMatchingLiveIdentity ? liveProvider : persistedProvider;

  let agentSessionId = hasMatchingLiveIdentity
    ? liveStatus.agentSessionId ?? null
    : provider.readSessionId(found.tab);
  let jsonlPath = provider.readJsonlPath(found.tab);

  if (!hasMatchingLiveIdentity) {
    const panePid = await dependencies.getSessionPanePid(found.tab.sessionName);
    if (panePid) {
      const detected = await provider.detectActiveSession(panePid);
      if (detected.status === 'running') {
        agentSessionId = detected.sessionId;
        jsonlPath = detected.jsonlPath;
      } else if (await provider.isAgentRunning(panePid)) {
        agentSessionId = null;
        jsonlPath = null;
      }
    }
  }

  const jsonlSessionId = provider.sessionIdFromJsonlPath(jsonlPath);
  if (agentSessionId && jsonlSessionId && agentSessionId !== jsonlSessionId) {
    jsonlPath = null;
  }
  if (!hasMatchingLiveIdentity) {
    agentSessionId = agentSessionId ?? jsonlSessionId;
  } else if (!agentSessionId) {
    // A matching live entry is authoritative even while persistence is catching up
    // or still contains metadata from an earlier runtime.
    jsonlPath = null;
  } else if (jsonlSessionId !== agentSessionId) {
    // Persisted JSONL is usable with live identity only when the provider can
    // prove that the path belongs to that same session.
    jsonlPath = null;
  }
  if (!agentSessionId) {
    return unavailableResult(found, provider, 'not-ready', 'agent-session-id-unavailable');
  }

  jsonlPath = jsonlPath
    ?? await dependencies.resolveProviderJsonlPath(provider, found.tab.sessionName, agentSessionId);
  if (!jsonlPath || !dependencies.existsSync(jsonlPath)) {
    return unavailableResult(found, provider, 'not-ready', 'jsonl-unavailable', agentSessionId);
  }
  if (!dependencies.isAllowedJsonlPath(jsonlPath)) {
    return unavailableResult(found, provider, 'unavailable', 'jsonl-path-not-allowed', agentSessionId);
  }

  const entries = await dependencies.readProviderTimelineUntil(
    provider,
    jsonlPath,
    MAX_RESULT_TIMELINE_ENTRIES,
    (candidateEntries) => extractLatestCompletedAssistantResponse(candidateEntries).response !== null,
  );
  const { response, interrupted } = extractLatestCompletedAssistantResponse(entries);
  if (!response) {
    return unavailableResult(
      found,
      provider,
      interrupted ? 'interrupted' : 'not-ready',
      interrupted ? 'turn-interrupted' : 'assistant-response-unavailable',
      agentSessionId,
      interrupted,
    );
  }

  return {
    tabId: found.tab.id,
    workspaceId: found.workspaceId,
    panelType: found.tab.panelType ?? 'terminal',
    agentProviderId: provider.id,
    agentSessionId,
    status: 'completed',
    reason: null,
    text: response.text,
    completed: true,
    timestamp: response.timestamp,
    completionTimestamp: response.completionTimestamp,
    interrupted,
  };
};
