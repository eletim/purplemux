import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData, ITab, IWorkspace } from '@/types/terminal';

const router = vi.hoisted(() => ({
  pathname: '/',
  push: vi.fn(async () => true),
}));

vi.mock('next/router', () => ({ default: router }));

import { navigateToTab, useLayoutStore } from '@/hooks/use-layout';
import useWorkspaceStore from '@/hooks/use-workspace-store';

const tab = (id: string, order: number): ITab => ({
  id,
  order,
  name: id,
  sessionName: `session-${id}`,
});

const layout = (tabs: ITab[]): ILayoutData => ({
  root: {
    type: 'pane',
    id: 'pane-target',
    tabs,
    activeTabId: tabs[0]?.id ?? null,
  },
  activePaneId: 'pane-target',
  updatedAt: '2026-09-11T00:00:00.000Z',
});

const workspace = (id: string): IWorkspace => ({
  id,
  name: id,
  directories: [`/tmp/${id}`],
});

describe('navigateToTab', () => {
  beforeEach(() => {
    router.pathname = '/';
    router.push.mockClear();
    useWorkspaceStore.setState({
      workspaces: [workspace('ws-current'), workspace('ws-target')],
      activeWorkspaceId: 'ws-current',
      isLoading: false,
      error: null,
    });
    useLayoutStore.setState({
      layout: layout([tab('current-tab', 0)]),
      workspaceId: 'ws-current',
      isLoading: false,
      error: null,
      pendingFocusTabId: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const loadTargetLayout = async (targetLayout: ILayoutData) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return {
        ok: true,
        json: async () => url.startsWith('/api/layout') ? targetLayout : {},
      };
    }));

    const navigation = navigateToTab('ws-target', 'target-tab');
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-target');
    expect(useLayoutStore.getState().pendingFocusTabId).toBe('target-tab');

    useLayoutStore.getState().setWorkspaceId('ws-target');
    await useLayoutStore.getState().fetchLayout('ws-target');
    return navigation;
  };

  it('switches workspace, loads its layout, and focuses the requested tab', async () => {
    const targetLayout = layout([tab('other-tab', 0), tab('target-tab', 1)]);

    await expect(loadTargetLayout(targetLayout)).resolves.toBe('focused');

    expect(targetLayout.root.type === 'pane' ? targetLayout.root.activeTabId : null).toBe('target-tab');
    expect(useLayoutStore.getState().layout?.activePaneId).toBe('pane-target');
  });

  it('opens the requested workspace and reports when its layout lacks the tab', async () => {
    const targetLayout = layout([tab('other-tab', 0)]);

    await expect(loadTargetLayout(targetLayout)).resolves.toBe('not-found');

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-target');
    expect(useLayoutStore.getState().workspaceId).toBe('ws-target');
  });
});
