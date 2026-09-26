import { describe, expect, it, vi } from 'vitest';
import { createExternalWorkspaceTab, getExternalWorkspaceSource,
  type IExternalWorkspaceAdapterDependencies } from '@/lib/external-workspace-adapter';

const server = {
  id: 'server-1', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
};
const pane = { id: '%2', index: 0, exists: true as const, active: true, pid: 123,
  currentCommand: 'bash', currentPath: '/work', dead: false };
const inventory = (windowIds: string[]) => ({
  ...server,
  exists: true,
  sessions: [{
    id: '$4', name: 'work', sessionCreated: '1750000001', exists: true as const,
    attached: false, owned: false,
    windows: windowIds.map((id, index) => ({
      id, name: `window-${index}`, index, exists: true as const, active: index === 0, panes: [pane],
    })),
  }],
});

describe('external Workspace/Tab adapter', () => {
  it('maps every fresh tmux snapshot using stable session and window IDs', async () => {
    const dependencies: IExternalWorkspaceAdapterDependencies = {
      getServer: vi.fn().mockResolvedValue(server),
      discover: vi.fn()
        .mockResolvedValueOnce(inventory(['@2']))
        .mockResolvedValueOnce(inventory(['@2', '@7'])),
      createWindow: vi.fn(),
    };

    const first = await getExternalWorkspaceSource('server-1', dependencies);
    const second = await getExternalWorkspaceSource('server-1', dependencies);

    expect(first).toEqual({
      serverId: 'server-1', name: 'dev', exists: true,
      workspaces: [{
        id: '$4', name: 'work', sessionCreated: '1750000001', attached: false,
        tabs: [{
          id: '@2', workspaceId: '$4', name: 'window-0', order: 0, active: true, panes: [pane],
          externalTerminalTarget: { serverId: 'server-1', sessionId: '$4', windowId: '@2' },
        }],
      }],
    });
    expect(second?.workspaces[0].tabs.map(({ id }) => id)).toEqual(['@2', '@7']);
    expect(dependencies.discover).toHaveBeenCalledTimes(2);
  });

  it('keeps unavailable sources selectable without inventing persisted workspaces', async () => {
    const dependencies: IExternalWorkspaceAdapterDependencies = {
      getServer: vi.fn().mockResolvedValue(server),
      discover: vi.fn().mockResolvedValue({
        ...server, exists: false, sessions: [], unavailableReason: 'Socket disappeared',
      }),
      createWindow: vi.fn(),
    };

    await expect(getExternalWorkspaceSource('server-1', dependencies)).resolves.toEqual({
      serverId: 'server-1', name: 'dev', exists: false, workspaces: [],
      unavailableReason: 'Socket disappeared',
    });
    dependencies.getServer = vi.fn().mockResolvedValue(undefined);
    await expect(getExternalWorkspaceSource('missing', dependencies)).resolves.toBeUndefined();
  });

  it('passes the exact Workspace identity to new-window and returns selection IDs', async () => {
    const dependencies: IExternalWorkspaceAdapterDependencies = {
      getServer: vi.fn(),
      discover: vi.fn(),
      createWindow: vi.fn().mockResolvedValue({
        serverId: 'server-1', sessionId: '$4', sessionCreated: '1750000001', windowId: '@7',
      }),
    };

    await expect(createExternalWorkspaceTab('server-1',
      { id: '$4', sessionCreated: '1750000001' }, dependencies)).resolves.toEqual({
      tabId: '@7', workspaceId: '$4', sessionCreated: '1750000001',
      externalTerminalTarget: { serverId: 'server-1', sessionId: '$4', windowId: '@7' },
    });
    expect(dependencies.createWindow).toHaveBeenCalledWith('server-1',
      { id: '$4', sessionCreated: '1750000001' });
  });
});
