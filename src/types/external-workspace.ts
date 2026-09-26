import type { IExternalTerminalTarget } from '@/types/terminal';
import type { IExternalTmuxPane } from '@/types/external-server';

/** A live tmux window represented at the shared UI's Tab boundary. */
export interface IExternalWorkspaceTab {
  id: string;
  workspaceId: string;
  name: string;
  order: number;
  active: boolean;
  panes: IExternalTmuxPane[];
  externalTerminalTarget: IExternalTerminalTarget;
}

/** A live tmux session represented at the shared UI's Workspace boundary. */
export interface IExternalWorkspace {
  id: string;
  name: string;
  sessionCreated: string;
  attached: boolean;
  tabs: IExternalWorkspaceTab[];
}

/** A registered source combined with a fresh, non-persisted workspace view. */
export interface IExternalWorkspaceSource {
  serverId: string;
  name: string;
  exists: boolean;
  workspaces: IExternalWorkspace[];
  unavailableReason?: string;
}

export interface ICreatedExternalWorkspaceTab {
  tabId: string;
  workspaceId: string;
  sessionCreated: string;
  externalTerminalTarget: IExternalTerminalTarget;
}
