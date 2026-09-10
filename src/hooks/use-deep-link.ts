import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import { useLayoutStore } from '@/hooks/use-layout';
import { collectPanes } from '@/lib/layout-tree';

interface IDeepLinkTarget {
  workspaceId: string;
  tabId: string;
}

export const parseDeepLinkTarget = (
  workspace: string | string[] | undefined,
  tab: string | string[] | undefined,
): IDeepLinkTarget | null => {
  if (typeof workspace !== 'string' || typeof tab !== 'string') return null;
  if (!workspace || !tab) return null;
  return { workspaceId: workspace, tabId: tab };
};

const useDeepLink = () => {
  const router = useRouter();
  const t = useTranslations('terminal');
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspacesLoading = useWorkspaceStore((state) => state.isLoading);
  const layout = useLayoutStore((state) => state.layout);
  const layoutWorkspaceId = useLayoutStore((state) => state.workspaceId);
  const layoutLoading = useLayoutStore((state) => state.isLoading);
  const handledKeyRef = useRef<string | null>(null);

  const target = useMemo(
    () => parseDeepLinkTarget(router.query.workspace, router.query.tab),
    [router.query.tab, router.query.workspace],
  );

  useEffect(() => {
    if (!router.isReady || !target || workspacesLoading) return;

    const key = JSON.stringify([target.workspaceId, target.tabId]);
    if (handledKeyRef.current === key) return;

    if (!workspaces.some((workspace) => workspace.id === target.workspaceId)) {
      handledKeyRef.current = key;
      toast.error(t('deepLinkWorkspaceNotFound', { workspaceId: target.workspaceId }));
      return;
    }

    const workspaceState = useWorkspaceStore.getState();
    const layoutState = useLayoutStore.getState();
    if (workspaceState.activeWorkspaceId !== target.workspaceId) {
      useLayoutStore.setState({ pendingFocusTabId: target.tabId });
      if (layoutState.workspaceId !== target.workspaceId) {
        layoutState.clearLayout();
      }
      workspaceState.switchWorkspace(target.workspaceId);
      return;
    }

    if (
      layoutState.workspaceId !== target.workspaceId
      || !layoutState.layout
      || layoutState.isLoading
    ) {
      useLayoutStore.setState({ pendingFocusTabId: target.tabId });
      return;
    }

    const pane = collectPanes(layoutState.layout.root)
      .find((candidate) => candidate.tabs.some((tab) => tab.id === target.tabId));
    if (!pane) {
      toast.error(t('deepLinkTabNotFound', { tabId: target.tabId }));
    } else if (
      layoutState.layout.activePaneId !== pane.id
      || pane.activeTabId !== target.tabId
    ) {
      layoutState.focusTab(target.tabId);
    }
    handledKeyRef.current = key;
  }, [
    activeWorkspaceId,
    layout,
    layoutLoading,
    layoutWorkspaceId,
    router.isReady,
    t,
    target,
    workspaces,
    workspacesLoading,
  ]);
};

export default useDeepLink;
