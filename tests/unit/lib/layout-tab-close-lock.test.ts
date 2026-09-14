import fs from 'fs/promises';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData, ITab, IWorkspace } from '@/types/terminal';

const mocks = vi.hoisted(() => ({
  home: `/tmp/purplemux-layout-close-lock-${process.pid}`,
  createSession: vi.fn(),
  hasSession: vi.fn(),
  killSession: vi.fn(),
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: { ...actual, homedir: () => mocks.home },
    homedir: () => mocks.home,
  };
});
vi.mock('@/lib/tmux', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tmux')>(),
  createSession: mocks.createSession,
  hasSession: mocks.hasSession,
  killSession: mocks.killSession,
}));
vi.mock('@/lib/sync-server', () => ({ broadcastSync: vi.fn() }));

import {
  addTabToPane,
  clearLayoutCache,
  getLayout,
  removeTabFromPane,
  resolveLayoutFile,
  restartTabSession,
  runWithExistingTab,
} from '@/lib/layout-store';
import { createTabRuntime, type ITabRuntimeDependencies } from '@/lib/tab-runtime';

const workspaceId = 'ws-close-lock';

const writeLayout = async (layout: ILayoutData) => {
  const file = resolveLayoutFile(workspaceId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(layout));
  clearLayoutCache(workspaceId);
};

describe('removeTabFromPane serialization', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.rm(mocks.home, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(mocks.home, { recursive: true, force: true });
  });

  it('does not let a concurrent restart recreate a session during close', async () => {
    await writeLayout({
      root: {
        type: 'pane',
        id: 'pane-1',
        tabs: [{
          id: 'tab-1',
          sessionName: 'session-tab-1',
          name: 'Terminal',
          order: 0,
          panelType: 'terminal',
        }],
        activeTabId: 'tab-1',
      },
      activePaneId: 'pane-1',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });

    let finishKill!: () => void;
    mocks.killSession.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishKill = resolve;
    }));

    const close = removeTabFromPane(workspaceId, 'pane-1', 'tab-1');
    await vi.waitFor(() => expect(mocks.killSession).toHaveBeenCalledOnce());
    const restart = restartTabSession(workspaceId, 'pane-1', 'tab-1');
    await Promise.resolve();

    expect(mocks.hasSession).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();

    finishKill();
    await expect(close).resolves.toBe(true);
    await expect(restart).resolves.toBe(false);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('does not register a tab after a concurrent close removes it', async () => {
    await writeLayout({
      root: {
        type: 'pane',
        id: 'pane-1',
        tabs: [{
          id: 'tab-1',
          sessionName: 'session-tab-1',
          name: 'Terminal',
          order: 0,
          panelType: 'terminal',
        }],
        activeTabId: 'tab-1',
      },
      activePaneId: 'pane-1',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });

    let finishKill!: () => void;
    mocks.killSession.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishKill = resolve;
    }));

    const close = removeTabFromPane(workspaceId, 'pane-1', 'tab-1');
    await vi.waitFor(() => expect(mocks.killSession).toHaveBeenCalledOnce());
    const register = vi.fn();
    const guardedRegistration = runWithExistingTab(workspaceId, 'tab-1', register);

    expect(register).not.toHaveBeenCalled();
    finishKill();

    await expect(close).resolves.toBe(true);
    await expect(guardedRegistration).resolves.toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('does not leave runtime status when close wins after createTabRuntime persists the tab', async () => {
    await writeLayout({
      root: {
        type: 'pane',
        id: 'pane-1',
        tabs: [],
        activeTabId: null,
      },
      activePaneId: 'pane-1',
      updatedAt: '2026-09-14T00:00:00.000Z',
    });

    const workspace: IWorkspace = {
      id: workspaceId,
      name: 'Close race',
      directories: ['/workspace'],
    };
    let createdTab!: ITab;
    let reportTabCreated!: () => void;
    let finishAdd!: () => void;
    const tabCreated = new Promise<void>((resolve) => { reportTabCreated = resolve; });
    const addFinished = new Promise<void>((resolve) => { finishAdd = resolve; });
    const registerTab = vi.fn();
    const dependencies: ITabRuntimeDependencies = {
      getWorkspaceById: vi.fn(async () => workspace),
      getLayout,
      checkAgentAvailabilityForPanelType: vi.fn(async () => ({ ok: true as const, provider: null })),
      addTabToPane: async (...args) => {
        createdTab = (await addTabToPane(...args))!;
        reportTabCreated();
        await addFinished;
        return createdTab;
      },
      removeTabFromPane,
      runWithExistingTab,
      updateTabAgentSessionId: vi.fn(async () => undefined),
      getProviderByPanelType: vi.fn(() => null),
      getStatusManager: () => ({
        registerTab,
        markAgentLaunch: vi.fn(),
        removeTab: vi.fn(),
      }),
      sendKeys: vi.fn(async () => undefined),
    };

    const creation = createTabRuntime({ workspaceId, panelType: 'terminal' }, dependencies);
    await tabCreated;

    await expect(removeTabFromPane(workspaceId, 'pane-1', createdTab.id)).resolves.toBe(true);
    finishAdd();

    await expect(creation).resolves.toMatchObject({ tab: { id: createdTab.id } });
    expect(registerTab).not.toHaveBeenCalled();
    await expect(runWithExistingTab(workspaceId, createdTab.id, vi.fn())).resolves.toBe(false);
  });
});
