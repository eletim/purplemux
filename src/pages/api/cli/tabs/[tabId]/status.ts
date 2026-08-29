import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { findTab } from '@/lib/cli-utils';
import { hasSession, getPaneCurrentCommand } from '@/lib/tmux';
import { getProviderByPanelType } from '@/lib/providers';
import { getStatusManager } from '@/lib/status-manager';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const tabId = req.query.tabId as string;
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  const found = await findTab(workspaceId, tabId);
  if (!found) return res.status(404).json({ error: 'Tab not found' });

  const panelType = found.tab.panelType ?? 'terminal';
  const provider = getProviderByPanelType(panelType);
  const liveStatus = getStatusManager().getForClient(tabId);
  const livePanelType = liveStatus?.panelType ?? 'terminal';
  const hasMatchingLiveStatus = liveStatus?.workspaceId === workspaceId
    && livePanelType === panelType;
  // A missing entry is possible during server startup or for layouts created by
  // an older version. A mismatched entry can briefly exist after a panel switch.
  // Persisted fields are recovery-only; once a matching live entry exists,
  // StatusManager is the sole source for agent runtime state.
  const runtimeStatus = hasMatchingLiveStatus
    ? liveStatus
    : {
        cliState: found.tab.cliState ?? null,
        workspaceId,
        tabName: found.tab.name,
        panelType,
        agentProviderId: provider?.id ?? null,
        agentSessionId: provider?.readSessionId(found.tab) ?? null,
      };
  const alive = await hasSession(found.tab.sessionName);
  const currentCommand = alive ? await getPaneCurrentCommand(found.tab.sessionName) : null;
  const agentProviderId = runtimeStatus.agentProviderId ?? null;
  const agentSessionId = runtimeStatus.agentSessionId ?? null;
  return res.status(200).json({
    ...runtimeStatus,
    tabId,
    workspaceId,
    panelType,
    alive,
    // `command` is retained for existing CLI consumers. `currentCommand`
    // names the tmux lifecycle field explicitly and is not an agent-state input.
    command: currentCommand,
    currentCommand,
    agentProviderId,
    agentSessionId,
    // Response key kept as `claudeSessionId` for back-compat with external CLI consumers.
    claudeSessionId: agentSessionId,
  });
};

export default handler;
