import { useCallback } from 'react';
import { useRouter } from 'next/router';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import useWorkspaceLayouts from '@/hooks/use-workspace-layouts';
import { useLayoutStore } from '@/hooks/use-layout';
import { navigateToTab } from '@/hooks/use-layout';
import useSidebarActions from '@/hooks/use-sidebar-actions';
import useMobileLayoutActions from '@/hooks/use-mobile-layout-actions';
import useWebviewStore from '@/hooks/use-webview-store';
import type { IWorkspaceChromeSourceAdapter } from '@/types/workspace-chrome';
import { managedWorkspaceChromeCapabilities } from '@/types/workspace-chrome';

export default function useManagedWorkspaceSource(): IWorkspaceChromeSourceAdapter {
  const router = useRouter();
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const groups = useWorkspaceStore((state) => state.groups);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const isLoading = useWorkspaceStore((state) => state.isLoading);
  const error = useWorkspaceStore((state) => state.error);
  const workspaceLayouts = useWorkspaceLayouts();
  const layout = useLayoutStore((state) => state.layout);
  const layoutWorkspaceId = useLayoutStore((state) => state.workspaceId);
  const pendingFocusTabId = useLayoutStore((state) => state.pendingFocusTabId);
  const desktopSelect = useSidebarActions((state) => state.onSelectWorkspace);
  const mobileSelect = useMobileLayoutActions((state) => state.onSelectWorkspace);

  const activePanes = activeWorkspaceId ? workspaceLayouts[activeWorkspaceId] ?? [] : [];
  const currentLayout = activeWorkspaceId === layoutWorkspaceId ? layout : null;
  const pendingPane = pendingFocusTabId
    ? activePanes.find((pane) => pane.tabs.some((tab) => tab.id === pendingFocusTabId))
    : null;
  const isWorkspacePage = router.pathname === '/';
  const activePaneId = pendingPane?.id
    ?? (isWorkspacePage ? currentLayout?.activePaneId ?? activePanes[0]?.id ?? null : null);
  const activePane = activePanes.find((pane) => pane.id === activePaneId) ?? activePanes[0];
  const activeTabId = pendingPane
    ? pendingFocusTabId
    : isWorkspacePage ? activePane?.activeTabId ?? null : null;

  const selectWorkspace = useCallback((workspaceId: string) => {
    useWebviewStore.getState().hide();
    const registered = mobileSelect ?? desktopSelect;
    if (registered) registered(workspaceId);
    else if (useWorkspaceStore.getState().activeWorkspaceId !== workspaceId) {
      useWorkspaceStore.getState().switchWorkspace(workspaceId);
    }
    if (router.pathname !== '/') void router.push('/');
  }, [desktopSelect, mobileSelect, router]);

  const createTab = useCallback(async (workspaceId: string) => {
    if (workspaceId !== useWorkspaceStore.getState().activeWorkspaceId) return null;
    const state = useLayoutStore.getState();
    const paneId = state.layout?.activePaneId;
    return paneId ? state.createTabInPane(paneId, 'terminal') : null;
  }, []);

  return {
    kind: 'managed',
    workspaces,
    groups,
    workspaceLayouts,
    terminalTargets: Object.fromEntries(Object.values(workspaceLayouts)
      .flatMap((panes) => panes.flatMap((pane) => pane.tabs))
      .map((tab) => [tab.id, { kind: 'managed' as const, sessionName: tab.sessionName }])),
    activeWorkspaceId,
    activePaneId,
    activeTabId,
    isCreatingTab: false,
    isLoading,
    error,
    capabilities: managedWorkspaceChromeCapabilities,
    selectWorkspace,
    selectTab: (workspaceId, _paneId, tabId) => { void navigateToTab(workspaceId, tabId); },
    createTab,
    createWorkspace: async () => {
      const workspace = await useWorkspaceStore.getState().createWorkspace('');
      if (workspace) selectWorkspace(workspace.id);
    },
    refresh: () => { void useWorkspaceStore.getState().fetchWorkspaces(); },
  };
}
