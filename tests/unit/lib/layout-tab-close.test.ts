import fs from 'fs/promises';
import path from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData, IPaneNode, ITab } from '@/types/terminal';

const mocks = vi.hoisted(() => ({
  home: `/tmp/purplemux-layout-tab-close-${process.pid}`,
  killSession: vi.fn(),
  broadcastSync: vi.fn(),
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
  killSession: mocks.killSession,
}));
vi.mock('@/lib/sync-server', () => ({ broadcastSync: mocks.broadcastSync }));

import {
  clearLayoutCache,
  readLayoutFile,
  removeTabFromPane,
  resolveLayoutFile,
  setLayoutReconciler,
} from '@/lib/layout-store';

const tab = (id: string): ITab => ({
  id,
  sessionName: `session-${id}`,
  name: id,
  order: 0,
  panelType: 'codex-cli',
});

const pane = (id: string, tabIds: string[], activeTabId = tabIds[0] ?? null): IPaneNode => ({
  type: 'pane',
  id,
  tabs: tabIds.map((id, order) => ({ ...tab(id), order })),
  activeTabId,
});

const writeLayout = async (workspaceId: string, layout: ILayoutData) => {
  const file = resolveLayoutFile(workspaceId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(layout));
  clearLayoutCache(workspaceId);
};

describe('removeTabFromPane close semantics', () => {
  const workspaceId = 'ws-close';
  const statusTabs = new Set<string>();
  const removeStatus = vi.fn((tabId: string) => statusTabs.delete(tabId));
  const reconcileWorkspaceTabs = vi.fn((_workspaceId: string, validTabIds: readonly string[]) => {
    const valid = new Set(validTabIds);
    for (const tabId of statusTabs) {
      if (!valid.has(tabId)) removeStatus(tabId);
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.rm(mocks.home, { recursive: true, force: true });
    statusTabs.clear();
    mocks.killSession.mockResolvedValue(undefined);
    setLayoutReconciler({
      reconcileWorkspaceTabs,
      removeWorkspaceTabs: vi.fn(),
      syncAgentSessionId: vi.fn(),
    });
  });

  afterEach(() => setLayoutReconciler(null));

  afterAll(async () => {
    await fs.rm(mocks.home, { recursive: true, force: true });
  });

  it('kills the session, removes the tab, selects a survivor, and reconciles status once', async () => {
    statusTabs.add('tab-a');
    statusTabs.add('tab-b');
    await writeLayout(workspaceId, {
      root: pane('pane-1', ['tab-a', 'tab-b'], 'tab-a'),
      activePaneId: 'pane-1',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });

    await expect(removeTabFromPane(workspaceId, 'pane-1', 'tab-a')).resolves.toBe(true);

    const stored = await readLayoutFile(resolveLayoutFile(workspaceId));
    expect(mocks.killSession).toHaveBeenCalledOnce();
    expect(mocks.killSession).toHaveBeenCalledWith('session-tab-a');
    expect(stored?.root).toMatchObject({
      type: 'pane',
      id: 'pane-1',
      activeTabId: 'tab-b',
      tabs: [{ id: 'tab-b', order: 0 }],
    });
    expect(reconcileWorkspaceTabs).toHaveBeenCalledOnce();
    expect(reconcileWorkspaceTabs).toHaveBeenCalledWith(workspaceId, ['tab-b']);
    expect(removeStatus).toHaveBeenCalledOnce();
    expect(removeStatus).toHaveBeenCalledWith('tab-a');
  });

  it('keeps the sole pane when its final tab is removed', async () => {
    statusTabs.add('tab-a');
    await writeLayout(workspaceId, {
      root: pane('pane-1', ['tab-a']),
      activePaneId: 'pane-1',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });

    await removeTabFromPane(workspaceId, 'pane-1', 'tab-a');

    const stored = await readLayoutFile(resolveLayoutFile(workspaceId));
    expect(stored).toMatchObject({
      root: { type: 'pane', id: 'pane-1', tabs: [], activeTabId: null },
      activePaneId: 'pane-1',
    });
    expect(removeStatus).toHaveBeenCalledOnce();
  });

  it('removes an empty pane and moves active focus to the surviving pane', async () => {
    statusTabs.add('tab-a');
    statusTabs.add('tab-b');
    await writeLayout(workspaceId, {
      root: {
        type: 'split',
        orientation: 'horizontal',
        ratio: 50,
        children: [pane('pane-left', ['tab-a']), pane('pane-right', ['tab-b'])],
      },
      activePaneId: 'pane-left',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });

    await removeTabFromPane(workspaceId, 'pane-left', 'tab-a');

    const stored = await readLayoutFile(resolveLayoutFile(workspaceId));
    expect(stored).toMatchObject({
      root: { type: 'pane', id: 'pane-right', activeTabId: 'tab-b' },
      activePaneId: 'pane-right',
    });
    expect(removeStatus).toHaveBeenCalledOnce();
    expect(removeStatus).toHaveBeenCalledWith('tab-a');
  });

  it('cleans layout and status even when tmux cleanup reports a dead or failed session', async () => {
    statusTabs.add('tab-a');
    mocks.killSession.mockRejectedValue(new Error('session already gone'));
    await writeLayout(workspaceId, {
      root: pane('pane-1', ['tab-a']),
      activePaneId: 'pane-1',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });

    await expect(removeTabFromPane(workspaceId, 'pane-1', 'tab-a')).resolves.toBe(true);

    const stored = await readLayoutFile(resolveLayoutFile(workspaceId));
    expect(stored?.root).toMatchObject({ tabs: [], activeTabId: null });
    expect(removeStatus).toHaveBeenCalledOnce();
  });
});
