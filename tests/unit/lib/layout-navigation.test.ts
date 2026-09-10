import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData, ITab, IWorkspace } from '@/types/terminal';

const router = vi.hoisted(() => ({
  pathname: '/',
  push: vi.fn(async () => true),
}));

vi.mock('next/router', () => ({ default: router }));

import { navigateToTab, useLayoutStore } from '@/hooks/use-layout';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import { followDeepLink } from '@/hooks/use-deep-link';

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

  const stubLayoutFetch = (targetLayout: ILayoutData) => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return {
        ok: true,
        json: async () => url.startsWith('/api/layout') ? targetLayout : {},
      };
    }));
  };

  const loadTargetLayout = async (targetLayout: ILayoutData) => {
    stubLayoutFetch(targetLayout);
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

  it('cancels an unfinished request when the user switches away', async () => {
    stubLayoutFetch(layout([tab('target-tab', 0)]));
    const navigation = navigateToTab('ws-target', 'target-tab');

    useWorkspaceStore.getState().switchWorkspace('ws-current');

    await expect(navigation).resolves.toBe('cancelled');
    expect(useLayoutStore.getState().pendingFocusTabId).toBeNull();

    const lateLayout = layout([tab('other-tab', 0), tab('target-tab', 1)]);
    useLayoutStore.getState().setWorkspaceId('ws-target');
    useLayoutStore.getState().setLayout(lateLayout);
    expect(lateLayout.root.type === 'pane' ? lateLayout.root.activeTabId : null).toBe('other-tab');
  });

  it('aborts an unfinished request without clearing another pending focus', async () => {
    stubLayoutFetch(layout([tab('target-tab', 0)]));
    const controller = new AbortController();
    const navigation = navigateToTab('ws-target', 'target-tab', { signal: controller.signal });
    useLayoutStore.setState({ pendingFocusTabId: 'other-pending-tab' });

    controller.abort();

    await expect(navigation).resolves.toBe('cancelled');
    expect(useLayoutStore.getState().pendingFocusTabId).toBe('other-pending-tab');
  });

  it('suppresses the missing-tab fallback when a deep link is aborted on unmount', async () => {
    stubLayoutFetch(layout([tab('other-tab', 0)]));
    const controller = new AbortController();
    const notifyTabNotFound = vi.fn();
    const navigation = followDeepLink(
      { workspaceId: 'ws-target', tabId: 'target-tab' },
      true,
      {
        navigate: (workspaceId, tabId) => navigateToTab(workspaceId, tabId, {
          signal: controller.signal,
        }),
        notifyWorkspaceNotFound: vi.fn(),
        notifyTabNotFound,
      },
    );

    controller.abort();

    await expect(navigation).resolves.toBe('cancelled');
    expect(notifyTabNotFound).not.toHaveBeenCalled();
    expect(useLayoutStore.getState().pendingFocusTabId).toBeNull();
  });

  it('discards a stale layout before navigating from another route', async () => {
    router.pathname = '/reports';
    const targetLayout = layout([tab('other-tab', 0), tab('target-tab', 1)]);
    stubLayoutFetch(targetLayout);

    const navigation = navigateToTab('ws-target', 'target-tab');

    expect(useLayoutStore.getState().layout).toBeNull();
    expect(router.push).toHaveBeenCalledWith('/');
    useLayoutStore.getState().setWorkspaceId('ws-target');
    await useLayoutStore.getState().fetchLayout('ws-target');

    await expect(navigation).resolves.toBe('focused');
    expect(targetLayout.root.type === 'pane' ? targetLayout.root.activeTabId : null).toBe('target-tab');
  });

  it('fails navigation without creating recovery resources after repeated layout errors', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-target' });
    useLayoutStore.setState({
      layout: null,
      workspaceId: 'ws-target',
      isLoading: false,
      error: null,
      retryCount: 2,
      pendingFocusTabId: null,
    });
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => ({
      ok: false,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const navigation = navigateToTab('ws-target', 'target-tab');

    await expect(navigation).resolves.toBe('failed');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([, init]) => (
      (init as RequestInit | undefined)?.method === 'POST'
    ))).toBe(false);
    expect(useLayoutStore.getState()).toMatchObject({
      layout: null,
      retryCount: 3,
      pendingFocusTabId: null,
    });
  });

  it('claims an in-flight layout fetch and prevents its creation recovery', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-target' });
    useLayoutStore.setState({
      layout: null,
      workspaceId: 'ws-target',
      isLoading: false,
      error: null,
      retryCount: 2,
      pendingFocusTabId: null,
    });
    let resolveFetch = (_response: { ok: boolean; json: () => Promise<object> }): void => {
      throw new Error('Layout fetch did not start');
    };
    const fetchMock = vi.fn((_input: string | URL | Request, _init?: RequestInit) => (
      new Promise<{ ok: boolean; json: () => Promise<object> }>((resolve) => {
        resolveFetch = resolve;
      })
    ));
    vi.stubGlobal('fetch', fetchMock);

    const layoutFetch = useLayoutStore.getState().fetchLayout('ws-target');
    expect(useLayoutStore.getState().isLoading).toBe(true);
    const navigation = navigateToTab('ws-target', 'target-tab');

    resolveFetch({ ok: false, json: async () => ({}) });
    await layoutFetch;

    await expect(navigation).resolves.toBe('failed');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(useLayoutStore.getState()).toMatchObject({
      layout: null,
      retryCount: 3,
      pendingFocusTabId: null,
    });
  });
});
