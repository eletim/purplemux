import { createExternalSessionWindow, getExternalServer } from '@/lib/external-server-store';
import { discoverExternalServer } from '@/lib/external-server-tmux';
import type { ICreatedExternalWindow, IExternalServer, IExternalServerInventory } from '@/types/external-server';
import type { ICreatedExternalWorkspaceTab, IExternalWorkspaceSource } from '@/types/external-workspace';

export interface IExternalWorkspaceAdapterDependencies {
  getServer: (serverId: string) => Promise<IExternalServer | undefined>;
  discover: (server: IExternalServer) => Promise<IExternalServerInventory>;
  createWindow: (
    serverId: string,
    session: { id: string; sessionCreated: string; requestId: string },
  ) => Promise<ICreatedExternalWindow | undefined>;
}

const defaultDependencies: IExternalWorkspaceAdapterDependencies = {
  getServer: getExternalServer,
  discover: discoverExternalServer,
  createWindow: createExternalSessionWindow,
};

/** Convert one fresh tmux inventory without retaining or persisting any runtime resource. */
export const adaptExternalWorkspaceSource = (
  inventory: IExternalServerInventory,
): IExternalWorkspaceSource => ({
  serverId: inventory.id,
  name: inventory.name,
  exists: inventory.exists,
  ...(inventory.unavailableReason ? { unavailableReason: inventory.unavailableReason } : {}),
  workspaces: inventory.sessions.map((session) => ({
    id: session.id,
    name: session.name,
    sessionCreated: session.sessionCreated,
    attached: session.attached,
    tabs: session.windows.map((window) => ({
      id: window.id,
      workspaceId: session.id,
      name: window.name,
      order: window.index,
      active: window.active,
      panes: window.panes,
      externalTerminalTarget: {
        serverId: inventory.id,
        sessionId: session.id,
        windowId: window.id,
      },
    })),
  })),
});

/** Read a registration and discover its current tmux state on every call. */
export const getExternalWorkspaceSource = async (
  serverId: string,
  dependencies: IExternalWorkspaceAdapterDependencies = defaultDependencies,
): Promise<IExternalWorkspaceSource | undefined> => {
  const server = await dependencies.getServer(serverId);
  return server ? adaptExternalWorkspaceSource(await dependencies.discover(server)) : undefined;
};

/** Add a Tab to one exact live Workspace and return stable IDs for immediate selection. */
export const createExternalWorkspaceTab = async (
  serverId: string,
  workspace: { id: string; sessionCreated: string; requestId: string },
  dependencies: IExternalWorkspaceAdapterDependencies = defaultDependencies,
): Promise<ICreatedExternalWorkspaceTab | undefined> => {
  const created = await dependencies.createWindow(serverId, workspace);
  return created ? {
    tabId: created.windowId,
    workspaceId: created.sessionId,
    sessionCreated: created.sessionCreated,
    requestId: created.requestId,
    externalTerminalTarget: {
      serverId: created.serverId,
      sessionId: created.sessionId,
      windowId: created.windowId,
    },
  } : undefined;
};
