import { checkAgentAvailabilityForPanelType, toAgentAvailabilityError } from '@/lib/agent-availability';
import { getLayout, addTabToPane, removeTabFromPane, updateTabAgentSessionId } from '@/lib/layout-store';
import { findPane, getFirstPaneId } from '@/lib/layout-tree';
import { createLogger } from '@/lib/logger';
import { getStatusManager } from '@/lib/status-manager';
import { sendKeys } from '@/lib/tmux';
import { getWorkspaceById } from '@/lib/workspace-store';
import type { IAgentProvider } from '@/lib/providers';
import type { ITab, IWorkspace, TPanelType } from '@/types/terminal';
import type { ITabStatusEntry } from '@/types/status';

const log = createLogger('tab-runtime');

export const VALID_PANEL_TYPES: readonly TPanelType[] = [
  'terminal',
  'claude-code',
  'codex-cli',
  'agent-sessions',
  'web-browser',
  'diff',
];

const isPanelType = (value: unknown): value is TPanelType =>
  typeof value === 'string' && VALID_PANEL_TYPES.includes(value as TPanelType);

type TErrorBody = { error: string; [key: string]: unknown };

export class TabRuntimeError extends Error {
  readonly status: number;
  readonly body: TErrorBody;

  constructor(status: number, body: TErrorBody) {
    super(body.error);
    this.name = 'TabRuntimeError';
    this.status = status;
    this.body = body;
  }
}

export interface ICreateTabRuntimeOptions {
  workspaceId: string;
  paneId?: string;
  name?: string;
  cwd?: string;
  panelType?: unknown;
  resumeSessionId?: string;
}

export interface ICreateTabRuntimeResult {
  workspace: IWorkspace;
  paneId: string;
  tab: ITab;
  provider: IAgentProvider | null;
}

interface IStatusRuntime {
  registerTab(tabId: string, entry: ITabStatusEntry): void;
  markAgentLaunch(tabId: string, options?: { resetAgentSession?: boolean }): void;
  removeTab(tabId: string): void;
}

export interface ITabRuntimeDependencies {
  getWorkspaceById: typeof getWorkspaceById;
  getLayout: typeof getLayout;
  checkAgentAvailabilityForPanelType: typeof checkAgentAvailabilityForPanelType;
  addTabToPane: typeof addTabToPane;
  removeTabFromPane: typeof removeTabFromPane;
  updateTabAgentSessionId: typeof updateTabAgentSessionId;
  getStatusManager: () => IStatusRuntime;
  sendKeys: typeof sendKeys;
}

const defaultDependencies: ITabRuntimeDependencies = {
  getWorkspaceById,
  getLayout,
  checkAgentAvailabilityForPanelType,
  addTabToPane,
  removeTabFromPane,
  updateTabAgentSessionId,
  getStatusManager,
  sendKeys,
};

const resolvePanelType = (value: unknown): TPanelType => {
  if (value === undefined) return 'terminal';
  if (isPanelType(value)) return value;
  throw new TabRuntimeError(400, {
    error: 'Invalid panelType',
    validPanelTypes: VALID_PANEL_TYPES,
  });
};

const buildAgentLaunchCommand = async (
  provider: IAgentProvider | null,
  workspaceId: string,
  resumeSessionId?: string,
): Promise<string | null> => {
  if (!provider) {
    if (resumeSessionId) {
      throw new TabRuntimeError(400, { error: 'Unknown panel type for resume' });
    }
    return null;
  }

  if (resumeSessionId) {
    if (!provider.isValidSessionId(resumeSessionId)) {
      throw new TabRuntimeError(400, { error: 'Invalid session ID format' });
    }
    return provider.buildResumeCommand(resumeSessionId, { workspaceId });
  }

  return provider.buildLaunchCommand({ workspaceId });
};

const registerRuntimeTab = (
  statusManager: IStatusRuntime,
  workspaceId: string,
  tab: ITab,
  provider: IAgentProvider | null,
) => {
  if (tab.panelType === 'web-browser') return;
  statusManager.registerTab(tab.id, {
    cliState: 'inactive',
    workspaceId,
    tabName: tab.name,
    tmuxSession: tab.sessionName,
    panelType: tab.panelType,
    agentProviderId: provider?.id,
    agentSessionId: provider?.readSessionId(tab) ?? null,
    lastEvent: null,
    eventSeq: 0,
  });
};

const rollbackCreatedTab = async (
  workspaceId: string,
  paneId: string,
  tab: ITab,
  previousActiveTabId: string | null,
  statusManager: IStatusRuntime,
  deps: ITabRuntimeDependencies,
) => {
  try {
    const removed = await deps.removeTabFromPane(
      workspaceId,
      paneId,
      tab.id,
      previousActiveTabId,
    );
    if (!removed) {
      log.error({ workspaceId, paneId, tabId: tab.id }, 'create rollback could not find persisted tab');
      return;
    }
    statusManager.removeTab(tab.id);
  } catch (cleanupError) {
    log.error(
      { err: cleanupError, workspaceId, paneId, tabId: tab.id, tmuxSession: tab.sessionName },
      'create rollback failed',
    );
  }
};

export const createTabRuntime = async (
  options: ICreateTabRuntimeOptions,
  dependencies: ITabRuntimeDependencies = defaultDependencies,
): Promise<ICreateTabRuntimeResult> => {
  const workspace = await dependencies.getWorkspaceById(options.workspaceId);
  if (!workspace) {
    throw new TabRuntimeError(404, { error: 'Workspace not found' });
  }

  const panelType = resolvePanelType(options.panelType);
  const layout = await dependencies.getLayout(options.workspaceId);
  const paneId = options.paneId ?? getFirstPaneId(layout.root);
  const pane = findPane(layout.root, paneId);
  if (!pane) {
    throw new TabRuntimeError(options.paneId ? 404 : 500, {
      error: options.paneId ? 'Pane not found' : 'No pane available in workspace',
    });
  }
  const previousActiveTabId = pane.activeTabId;

  const availability = await dependencies.checkAgentAvailabilityForPanelType(panelType);
  if (!availability.ok) {
    throw new TabRuntimeError(availability.status, toAgentAvailabilityError(availability));
  }
  const provider = availability.provider;

  // Build provider-specific commands before creating any tmux/layout resources.
  const launchCommand = await buildAgentLaunchCommand(
    provider,
    workspace.id,
    options.resumeSessionId,
  );

  const tab = await dependencies.addTabToPane(
    workspace.id,
    paneId,
    options.name,
    options.cwd,
    panelType,
  );
  if (!tab) {
    throw new TabRuntimeError(404, { error: 'Pane not found' });
  }

  const statusManager = dependencies.getStatusManager();
  try {
    if (provider) {
      const sessionId = options.resumeSessionId ?? null;
      provider.writeSessionId(tab, sessionId);
      await dependencies.updateTabAgentSessionId(
        tab.sessionName,
        provider,
        sessionId,
      );
    }

    // Hooks can arrive as soon as the command starts. Establish the complete
    // tab/workspace/session mapping in StatusManager before sending it.
    registerRuntimeTab(statusManager, workspace.id, tab, provider);

    if (provider && launchCommand) {
      await dependencies.sendKeys(tab.sessionName, launchCommand);
      statusManager.markAgentLaunch(tab.id);
    }

    return { workspace, paneId, tab, provider };
  } catch (error) {
    await rollbackCreatedTab(
      workspace.id,
      paneId,
      tab,
      previousActiveTabId,
      statusManager,
      dependencies,
    );
    throw error;
  }
};
