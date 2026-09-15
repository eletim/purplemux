import { checkAgentAvailabilityForPanelType, toAgentAvailabilityError } from '@/lib/agent-availability';
import { runWithExistingTab, updateTabAgentSessionId } from '@/lib/layout-store';
import { createLogger } from '@/lib/logger';
import { getProviderByPanelType } from '@/lib/providers';
import { registerExistingRuntimeTab } from '@/lib/runtime-tab-registration';
import { getStatusManager } from '@/lib/status-manager';
import { sendKeys } from '@/lib/tmux';
import { createWorkspaceWithInitialTab } from '@/lib/workspace-store';
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

export interface IInitialWorkspaceTab {
  tabId: string;
  workspaceId: string;
  name: string;
  panelType: TPanelType;
  agentProviderId: string | null;
}

export interface ICreateWorkspaceRuntimeResult {
  workspace: IWorkspace;
  initialTab: IInitialWorkspaceTab;
}

interface IWorkspaceStatusRuntime {
  registerTab(tabId: string, entry: ITabStatusEntry): void;
  markAgentLaunch(tabId: string): void;
}

export interface IWorkspaceRuntimeDependencies {
  createWorkspace: typeof createWorkspaceWithInitialTab;
  runWithExistingTab: typeof runWithExistingTab;
  updateTabAgentSessionId: typeof updateTabAgentSessionId;
  getProviderByPanelType: typeof getProviderByPanelType;
  checkAgentAvailabilityForPanelType: typeof checkAgentAvailabilityForPanelType;
  getStatusManager: () => IWorkspaceStatusRuntime;
  sendKeys: typeof sendKeys;
}

const defaultDependencies: IWorkspaceRuntimeDependencies = {
  createWorkspace: createWorkspaceWithInitialTab,
  runWithExistingTab,
  updateTabAgentSessionId,
  getProviderByPanelType,
  checkAgentAvailabilityForPanelType,
  getStatusManager,
  sendKeys,
};

export const createWorkspaceRuntime = async (
  options: ICreateWorkspaceRuntimeOptions,
  dependencies: IWorkspaceRuntimeDependencies = defaultDependencies,
): Promise<ICreateWorkspaceRuntimeResult> => {
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
  const { workspace, initialTab: defaultTab } = await dependencies.createWorkspace(
    options.directory,
    options.name,
    layoutOptions,
  );

  const tabProvider = dependencies.getProviderByPanelType(defaultTab.panelType);

  if (options.resumeSessionId && provider) {
    provider.writeSessionId(defaultTab, options.resumeSessionId);
    await dependencies.updateTabAgentSessionId(
      defaultTab.sessionName,
      provider,
      options.resumeSessionId,
    );
  }

  const initialTabPresent = await registerExistingRuntimeTab(
    workspace.id,
    defaultTab.id,
    dependencies,
  );

  if (options.resumeSessionId && provider && initialTabPresent) {
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

  return {
    workspace,
    initialTab: {
      tabId: defaultTab.id,
      workspaceId: workspace.id,
      name: defaultTab.name,
      panelType: defaultTab.panelType ?? 'terminal',
      agentProviderId: tabProvider?.id ?? null,
    },
  };
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
