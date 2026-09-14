import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceRuntime,
  type IWorkspaceRuntimeDependencies,
} from '@/lib/workspace-runtime';
import type { IAgentProvider } from '@/lib/providers';
import type { ILayoutData, ITab, IWorkspace } from '@/types/terminal';

const workspace: IWorkspace = {
  id: 'ws-created',
  name: 'Workspace 7',
  directories: ['/requested/cwd'],
};

const initialTab: ITab = {
  id: 'tab-initial',
  sessionName: 'pmux-ws-created-pane-1-tab-initial',
  name: 'Terminal',
  order: 0,
  panelType: 'terminal',
};

const layout: ILayoutData = {
  root: {
    type: 'pane',
    id: 'pane-1',
    tabs: [initialTab],
    activeTabId: initialTab.id,
  },
  activePaneId: 'pane-1',
  updatedAt: '2026-08-30T00:00:00.000Z',
};

const makeDependencies = () => {
  const runtimeTabIds = new Set<string>();
  const statusManager = {
    registerTab: vi.fn((tabId: string) => { runtimeTabIds.add(tabId); }),
    markAgentLaunch: vi.fn(),
  };
  const dependencies = {
    createWorkspace: vi.fn(async () => ({ workspace, initialTab })),
    runWithExistingTab: vi.fn(async (_workspaceId: string, _tabId: string, callback: (tab: ITab) => void) => {
      callback(initialTab);
      return true;
    }),
    updateTabAgentSessionId: vi.fn(async () => undefined),
    getProviderByPanelType: vi.fn(() => null),
    checkAgentAvailabilityForPanelType: vi.fn(async () => ({ ok: true as const, provider: null })),
    getStatusManager: vi.fn(() => statusManager),
    sendKeys: vi.fn(async () => undefined),
  } as unknown as IWorkspaceRuntimeDependencies;
  return { dependencies, statusManager, runtimeTabIds };
};

describe('createWorkspaceRuntime', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('creates the workspace and registers the initial runtime status mapping', async () => {
    const { dependencies, statusManager } = makeDependencies();

    const result = await createWorkspaceRuntime({
      directory: '/requested/cwd',
      name: 'Requested name',
    }, dependencies);

    expect(result).toEqual({
      workspace,
      initialTab: {
        tabId: initialTab.id,
        workspaceId: workspace.id,
        name: initialTab.name,
        panelType: 'terminal',
        agentProviderId: null,
      },
    });
    expect(dependencies.createWorkspace).toHaveBeenCalledWith(
      '/requested/cwd',
      'Requested name',
      undefined,
    );
    expect(statusManager.registerTab).toHaveBeenCalledWith(initialTab.id, {
      cliState: 'inactive',
      workspaceId: workspace.id,
      tabName: initialTab.name,
      tmuxSession: initialTab.sessionName,
      panelType: initialTab.panelType,
      agentProviderId: undefined,
      agentSessionId: null,
      lastEvent: null,
      eventSeq: 0,
    });
  });

  it('preserves the existing resume metadata and delayed launch semantics', async () => {
    vi.useFakeTimers();
    const { dependencies, statusManager } = makeDependencies();
    const provider = {
      id: 'codex',
      panelType: 'codex-cli',
      isValidSessionId: vi.fn(() => true),
      writeSessionId: vi.fn(),
      readSessionId: vi.fn(() => 'session-1'),
      buildResumeCommand: vi.fn(async () => 'codex resume session-1'),
    } as unknown as IAgentProvider;
    vi.mocked(dependencies.getProviderByPanelType).mockReturnValue(provider);
    const agentTab = { ...initialTab, panelType: 'codex-cli' as const };
    vi.mocked(dependencies.createWorkspace).mockResolvedValue({ workspace, initialTab: agentTab });
    vi.mocked(dependencies.runWithExistingTab).mockImplementation(async (_workspaceId, _tabId, callback) => {
      callback(agentTab);
      return true;
    });

    const result = await createWorkspaceRuntime({
      directory: '/requested/cwd',
      resumeSessionId: 'session-1',
      panelType: 'codex-cli',
    }, dependencies);

    expect(result.initialTab).toEqual({
      tabId: initialTab.id,
      workspaceId: workspace.id,
      name: initialTab.name,
      panelType: 'codex-cli',
      agentProviderId: 'codex',
    });

    expect(dependencies.checkAgentAvailabilityForPanelType).toHaveBeenCalledWith('codex-cli');
    expect(dependencies.createWorkspace).toHaveBeenCalledWith(
      '/requested/cwd',
      undefined,
      { panelType: 'codex-cli' },
    );
    expect(provider.writeSessionId).toHaveBeenCalledWith(expect.any(Object), 'session-1');
    expect(dependencies.updateTabAgentSessionId).toHaveBeenCalledWith(
      initialTab.sessionName,
      provider,
      'session-1',
    );

    await vi.advanceTimersByTimeAsync(500);

    expect(dependencies.sendKeys).toHaveBeenCalledWith(
      initialTab.sessionName,
      'codex resume session-1',
    );
    expect(statusManager.markAgentLaunch).toHaveBeenCalledWith(initialTab.id);
    vi.useRealTimers();
  });

  it('keeps the mutation-created tab identity when the persisted layout changes before the response', async () => {
    const { dependencies, runtimeTabIds } = makeDependencies();
    const replacementTab: ITab = {
      ...initialTab,
      id: 'tab-replacement',
      sessionName: 'pmux-ws-created-pane-1-tab-replacement',
    };
    layout.root = {
      type: 'pane',
      id: 'pane-1',
      tabs: [initialTab],
      activeTabId: initialTab.id,
    };
    vi.mocked(dependencies.createWorkspace).mockImplementation(async () => {
      layout.root = {
        type: 'pane',
        id: 'pane-1',
        tabs: [replacementTab],
        activeTabId: replacementTab.id,
      };
      return { workspace, initialTab };
    });
    runtimeTabIds.add(replacementTab.id);
    vi.mocked(dependencies.runWithExistingTab).mockImplementation(async (_workspaceId, tabId, callback) => {
      const currentTab = layout.root.type === 'pane'
        ? layout.root.tabs.find((tab) => tab.id === tabId)
        : undefined;
      if (!currentTab) return false;
      callback(currentTab);
      return true;
    });

    const result = await createWorkspaceRuntime({
      directory: '/requested/cwd',
    }, dependencies);

    expect(layout.root.type === 'pane' && layout.root.tabs[0]).toBe(replacementTab);
    expect(result.initialTab.tabId).toBe(initialTab.id);
    expect(runtimeTabIds).toEqual(new Set([replacementTab.id]));
  });
});
