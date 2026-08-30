import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTabRuntime, type ITabRuntimeDependencies } from '@/lib/tab-runtime';
import type { IAgentProvider } from '@/lib/providers';
import { codexProvider } from '@/lib/providers/codex';
import { claudeProvider } from '@/lib/providers/claude';
import type { ILayoutData, ITab, IWorkspace, TPanelType } from '@/types/terminal';

const workspace: IWorkspace = {
  id: 'ws-1',
  name: 'Workspace',
  directories: ['/workspace/default'],
};

const layout: ILayoutData = {
  root: { type: 'pane', id: 'pane-1', tabs: [], activeTabId: null },
  activePaneId: 'pane-1',
  updatedAt: '2026-08-29T00:00:00.000Z',
};

const makeTab = (panelType: TPanelType = 'terminal', cwd?: string): ITab => ({
  id: 'tab-1',
  sessionName: 'pmux-ws-1-pane-1-tab-1',
  name: 'New tab',
  order: 0,
  panelType,
  ...(cwd ? { cwd } : {}),
});

const makeProvider = (panelType: 'codex-cli' | 'claude-code') => {
  const id = panelType === 'codex-cli' ? 'codex' : 'claude';
  return {
    id,
    displayName: id,
    panelType,
    isValidSessionId: vi.fn(() => true),
    buildLaunchCommand: vi.fn(async () => `${id} launch`),
    buildResumeCommand: vi.fn(async (sessionId: string) => `${id} resume ${sessionId}`),
    readSessionId: vi.fn(() => null),
    writeSessionId: vi.fn(),
  } as unknown as IAgentProvider;
};

const makeDependencies = (provider: IAgentProvider | null, events: string[] = []) => {
  let persistedTab: ITab | null = null;
  const statusManager = {
    registerTab: vi.fn(() => events.push('register')),
    markAgentLaunch: vi.fn(() => events.push('mark')),
    removeTab: vi.fn(() => events.push('status-remove')),
  };
  const dependencies = {
    getWorkspaceById: vi.fn(async () => workspace),
    getLayout: vi.fn(async () => layout),
    checkAgentAvailabilityForPanelType: vi.fn(async () => ({ ok: true as const, provider })),
    addTabToPane: vi.fn(async (_wsId, _paneId, _name, cwd, panelType) => {
      events.push('create');
      persistedTab = makeTab((panelType as TPanelType | undefined) ?? 'terminal', cwd);
      return persistedTab;
    }),
    removeTabFromPane: vi.fn(async () => {
      events.push('layout-remove');
      persistedTab = null;
      return true;
    }),
    updateTabAgentSessionId: vi.fn(async () => undefined),
    getStatusManager: vi.fn(() => statusManager),
    sendKeys: vi.fn(async () => {
      events.push('send');
    }),
  } as unknown as ITabRuntimeDependencies;
  return { dependencies, statusManager, getPersistedTab: () => persistedTab };
};

describe('createTabRuntime', () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each([
    ['codex-cli', codexProvider, 'codex launch'],
    ['claude-code', claudeProvider, 'claude launch'],
  ] as const)('uses the %s provider launch command as the command source of truth', async (panelType, provider, command) => {
    const buildLaunchCommand = vi.spyOn(provider, 'buildLaunchCommand').mockResolvedValue(command);
    const { dependencies } = makeDependencies(provider);

    await createTabRuntime({ workspaceId: workspace.id, panelType }, dependencies);

    expect(buildLaunchCommand).toHaveBeenCalledOnce();
    expect(buildLaunchCommand).toHaveBeenCalledWith({ workspaceId: workspace.id });
    expect(dependencies.updateTabAgentSessionId).toHaveBeenCalledWith(
      'pmux-ws-1-pane-1-tab-1',
      provider,
      null,
    );
    expect(dependencies.sendKeys).toHaveBeenCalledWith('pmux-ws-1-pane-1-tab-1', command);
  });

  it('does not run provider launch logic for a terminal tab', async () => {
    const provider = makeProvider('codex-cli');
    const { dependencies, statusManager } = makeDependencies(null);

    await createTabRuntime({ workspaceId: workspace.id, panelType: 'terminal' }, dependencies);

    expect(provider.buildLaunchCommand).not.toHaveBeenCalled();
    expect(dependencies.sendKeys).not.toHaveBeenCalled();
    expect(statusManager.registerTab).toHaveBeenCalledOnce();
    expect(statusManager.markAgentLaunch).not.toHaveBeenCalled();
  });

  it('registers the complete runtime mapping before launching the agent', async () => {
    const events: string[] = [];
    const provider = makeProvider('codex-cli');
    const { dependencies, statusManager } = makeDependencies(provider, events);

    await createTabRuntime({ workspaceId: workspace.id, panelType: 'codex-cli' }, dependencies);

    expect(events).toEqual(['create', 'register', 'send', 'mark']);
    expect(statusManager.registerTab).toHaveBeenCalledWith('tab-1', expect.objectContaining({
      workspaceId: 'ws-1',
      tmuxSession: 'pmux-ws-1-pane-1-tab-1',
      panelType: 'codex-cli',
      agentProviderId: 'codex',
    }));
  });

  it('creates no tmux/layout resource when provider command generation fails', async () => {
    const provider = makeProvider('codex-cli');
    vi.mocked(provider.buildLaunchCommand).mockRejectedValueOnce(new Error('command failed'));
    const { dependencies, getPersistedTab } = makeDependencies(provider);

    await expect(createTabRuntime({ workspaceId: workspace.id, panelType: 'codex-cli' }, dependencies))
      .rejects.toThrow('command failed');

    expect(dependencies.addTabToPane).not.toHaveBeenCalled();
    expect(dependencies.removeTabFromPane).not.toHaveBeenCalled();
    expect(getPersistedTab()).toBeNull();
  });

  it('removes status, layout, and tmux-backed tab state when launch send fails', async () => {
    const events: string[] = [];
    const provider = makeProvider('claude-code');
    const { dependencies, statusManager, getPersistedTab } = makeDependencies(provider, events);
    vi.mocked(dependencies.sendKeys).mockImplementationOnce(async () => {
      events.push('send');
      throw new Error('send failed');
    });

    await expect(createTabRuntime({ workspaceId: workspace.id, panelType: 'claude-code' }, dependencies))
      .rejects.toThrow('send failed');

    expect(events).toEqual(['create', 'register', 'send', 'layout-remove', 'status-remove']);
    expect(statusManager.markAgentLaunch).not.toHaveBeenCalled();
    expect(getPersistedTab()).toBeNull();
  });

  it('preserves the create error and runtime metadata when rollback cleanup fails', async () => {
    const events: string[] = [];
    const provider = makeProvider('codex-cli');
    const { dependencies, statusManager, getPersistedTab } = makeDependencies(provider, events);
    const createError = new Error('send failed');
    vi.mocked(dependencies.sendKeys).mockImplementationOnce(async () => {
      events.push('send');
      throw createError;
    });
    vi.mocked(dependencies.removeTabFromPane).mockImplementationOnce(async () => {
      events.push('layout-remove');
      throw new Error('kill failed');
    });

    await expect(createTabRuntime({ workspaceId: workspace.id, panelType: 'codex-cli' }, dependencies))
      .rejects.toBe(createError);

    expect(events).toEqual(['create', 'register', 'send', 'layout-remove']);
    expect(statusManager.removeTab).not.toHaveBeenCalled();
    expect(getPersistedTab()).toMatchObject({ id: 'tab-1' });
  });

  it('passes the previous active tab into the atomic launch rollback', async () => {
    const provider = makeProvider('codex-cli');
    const { dependencies } = makeDependencies(provider);
    vi.mocked(dependencies.getLayout).mockResolvedValueOnce({
      ...layout,
      root: {
        type: 'pane',
        id: 'pane-1',
        tabs: [{ ...makeTab('terminal'), id: 'previous-tab' }],
        activeTabId: 'previous-tab',
      },
    });
    vi.mocked(dependencies.sendKeys).mockRejectedValueOnce(new Error('send failed'));

    await expect(createTabRuntime({ workspaceId: workspace.id, panelType: 'codex-cli' }, dependencies))
      .rejects.toThrow('send failed');

    expect(dependencies.removeTabFromPane).toHaveBeenCalledWith(
      'ws-1',
      'pane-1',
      'tab-1',
      'previous-tab',
    );
  });

  it('preserves explicit pane and cwd semantics', async () => {
    const { dependencies } = makeDependencies(null);

    const result = await createTabRuntime({
      workspaceId: workspace.id,
      paneId: 'pane-1',
      cwd: '/requested/cwd',
      name: 'requested name',
      panelType: 'terminal',
    }, dependencies);

    expect(dependencies.addTabToPane).toHaveBeenCalledWith(
      'ws-1',
      'pane-1',
      'requested name',
      '/requested/cwd',
      'terminal',
    );
    expect(result.paneId).toBe('pane-1');
    expect(result.tab.cwd).toBe('/requested/cwd');
  });

  it('validates workspace and pane before creating resources', async () => {
    const missingWorkspace = makeDependencies(null).dependencies;
    vi.mocked(missingWorkspace.getWorkspaceById).mockResolvedValueOnce(undefined);
    await expect(createTabRuntime({ workspaceId: 'missing' }, missingWorkspace))
      .rejects.toEqual(expect.objectContaining({ status: 404 }));
    expect(missingWorkspace.addTabToPane).not.toHaveBeenCalled();

    const missingPane = makeDependencies(null).dependencies;
    await expect(createTabRuntime({ workspaceId: 'ws-1', paneId: 'missing' }, missingPane))
      .rejects.toEqual(expect.objectContaining({ status: 404 }));
    expect(missingPane.addTabToPane).not.toHaveBeenCalled();
  });
});
