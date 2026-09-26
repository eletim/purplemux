import type { IPaneNode, ITab, IWorkspace } from '@/types/terminal';

/** Operations and managed-only decorations understood by shared Workspace/Tab chrome. */
export interface IWorkspaceChromeCapabilities {
  createWorkspace: boolean;
  createTab: boolean;
  renameWorkspace: boolean;
  deleteWorkspace: boolean;
  organizeWorkspaces: boolean;
  renameTab: boolean;
  closeTab: boolean;
  reorderTabs: boolean;
  agentControls: boolean;
  providerControls: boolean;
  gitControls: boolean;
  persistenceControls: boolean;
  ownershipControls: boolean;
  lifecycleControls: boolean;
  terminalCopy: boolean;
}

export const managedWorkspaceChromeCapabilities: IWorkspaceChromeCapabilities = {
  createWorkspace: true,
  createTab: true,
  renameWorkspace: true,
  deleteWorkspace: true,
  organizeWorkspaces: true,
  renameTab: true,
  closeTab: true,
  reorderTabs: true,
  agentControls: true,
  providerControls: true,
  gitControls: true,
  persistenceControls: true,
  ownershipControls: true,
  lifecycleControls: true,
  terminalCopy: true,
};

export const externalWorkspaceChromeCapabilities: IWorkspaceChromeCapabilities = {
  createWorkspace: false,
  createTab: true,
  renameWorkspace: false,
  deleteWorkspace: false,
  organizeWorkspaces: false,
  renameTab: false,
  closeTab: false,
  reorderTabs: false,
  agentControls: false,
  providerControls: false,
  gitControls: false,
  persistenceControls: false,
  ownershipControls: false,
  lifecycleControls: false,
  terminalCopy: false,
};

/** Read/write boundary consumed by desktop and mobile Workspace/Tab chrome. */
export interface IWorkspaceChromeSourceAdapter {
  kind: 'managed' | 'external';
  label?: string;
  workspaces: IWorkspace[];
  workspaceLayouts: Record<string, IPaneNode[]>;
  activeWorkspaceId: string | null;
  activePaneId: string | null;
  activeTabId: string | null;
  isLoading: boolean;
  error: string | null;
  capabilities: IWorkspaceChromeCapabilities;
  selectWorkspace: (workspaceId: string) => void;
  selectTab: (workspaceId: string, paneId: string, tabId: string) => void;
  createTab?: (workspaceId: string) => Promise<ITab | null>;
  refresh: () => void;
}
