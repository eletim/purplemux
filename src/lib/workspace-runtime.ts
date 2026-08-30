import { checkAgentAvailabilityForPanelType, toAgentAvailabilityError } from '@/lib/agent-availability';
import { collectAllTabs, readLayoutFile, resolveLayoutFile, updateTabAgentSessionId } from '@/lib/layout-store';
import { createLogger } from '@/lib/logger';
import { getProviderByPanelType } from '@/lib/providers';
import { getStatusManager } from '@/lib/status-manager';
import { sendKeys } from '@/lib/tmux';
import { createWorkspace } from '@/lib/workspace-store';
import type { IWorkspace, TPanelType } from '@/types/terminal';
import type { ITabStatusEntry } from '@/types/status';

const log = createLogger('workspace-runtime');
const SHELL_READY_DELAY_MS = 500;

type TErrorBody = { error: string; [key: string]: unknown };

export class WorkspaceRuntimeError extends Error {
  readonly status: number;
  readonly body: TErrorBody;

  constructor(status: number, body: TErrorBody) {
    super(body.error);
    this.name = 'WorkspaceRuntimeError';
    this.status = status;
    this.body = body;
  }
}

export interface ICreateWorkspaceRuntimeOptions {
  directory: string;
  name?: string;
  resumeSessionId?: string;
  panelType?: TPanelType;
}

interface IWorkspaceStatusRuntime {
  registerTab(tabId: string, entry: ITabStatusEntry): void;
  markAgentLaunch(tabId: string): void;
}

export interface IWorkspaceRuntimeDependencies {
  createWorkspace: typeof createWorkspace;
  readLayoutFile: typeof readLayoutFile;
  resolveLayoutFile: typeof resolveLayoutFile;
  collectAllTabs: typeof collectAllTabs;
  updateTabAgentSessionId: typeof updateTabAgentSessionId;
  getProviderByPanelType: typeof getProviderByPanelType;
  checkAgentAvailabilityForPanelType: typeof checkAgentAvailabilityForPanelType;
  getStatusManager: () => IWorkspaceStatusRuntime;
  sendKeys: typeof sendKeys;
}

const defaultDependencies: IWorkspaceRuntimeDependencies = {
  createWorkspace,
  readLayoutFile,
  resolveLayoutFile,
  collectAllTabs,
  updateTabAgentSessionId,
  getProviderByPanelType,
  checkAgentAvailabilityForPanelType,
  getStatusManager,
  sendKeys,
};

export const createWorkspaceRuntime = async (
  options: ICreateWorkspaceRuntimeOptions,
  dependencies: IWorkspaceRuntimeDependencies = defaultDependencies,
): Promise<IWorkspace> => {
  const provider = options.resumeSessionId
    ? dependencies.getProviderByPanelType(options.panelType ?? 'claude-code')
    : null;

  if (options.resumeSessionId) {
    if (!provider) {
      throw new WorkspaceRuntimeError(400, { error: 'Unknown panel type for resume' });
    }
    if (!provider.isValidSessionId(options.resumeSessionId)) {
      throw new WorkspaceRuntimeError(400, { error: 'Invalid session ID format' });
    }
    const availability = await dependencies.checkAgentAvailabilityForPanelType(provider.panelType);
    if (!availability.ok) {
      throw new WorkspaceRuntimeError(availability.status, toAgentAvailabilityError(availability));
    }
  }

  const layoutOptions = provider ? { panelType: provider.panelType } : undefined;
  const workspace = await dependencies.createWorkspace(
    options.directory,
    options.name,
    layoutOptions,
  );

  const layout = await dependencies.readLayoutFile(
    dependencies.resolveLayoutFile(workspace.id),
  );
  const defaultTab = layout ? dependencies.collectAllTabs(layout.root)[0] : null;

  if (options.resumeSessionId && provider && defaultTab) {
    provider.writeSessionId(defaultTab, options.resumeSessionId);
    await dependencies.updateTabAgentSessionId(
      defaultTab.sessionName,
      provider,
      options.resumeSessionId,
    );
  }

  if (defaultTab && defaultTab.panelType !== 'web-browser') {
    const tabProvider = dependencies.getProviderByPanelType(defaultTab.panelType);
    dependencies.getStatusManager().registerTab(defaultTab.id, {
      cliState: 'inactive',
      workspaceId: workspace.id,
      tabName: defaultTab.name,
      tmuxSession: defaultTab.sessionName,
      panelType: defaultTab.panelType,
      agentProviderId: tabProvider?.id,
      agentSessionId: tabProvider?.readSessionId(defaultTab) ?? null,
      lastEvent: null,
      eventSeq: 0,
    });
  }

  if (options.resumeSessionId && provider && defaultTab) {
    const resumeSessionId = options.resumeSessionId;
    setTimeout(async () => {
      try {
        const resumeCommand = await provider.buildResumeCommand(
          resumeSessionId,
          { workspaceId: workspace.id },
        );
        await dependencies.sendKeys(defaultTab.sessionName, resumeCommand);
        dependencies.getStatusManager().markAgentLaunch(defaultTab.id);
      } catch (error) {
        log.warn(`resume sendKeys failed: ${error instanceof Error ? error.message : error}`);
      }
    }, SHELL_READY_DELAY_MS);
  }

  return workspace;
};

export const getWorkspaceRuntimeHttpError = (
  error: unknown,
): { status: number; body: TErrorBody } => {
  if (error instanceof WorkspaceRuntimeError) {
    return { status: error.status, body: error.body };
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  const isValidation = ['not exist', 'directory', 'registered'].some((keyword) =>
    message.includes(keyword));
  return {
    status: isValidation ? 400 : 500,
    body: { error: message },
  };
};
