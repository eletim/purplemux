import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import { navigateToTab, type TNavigateToTabResult } from '@/hooks/use-layout';

interface IDeepLinkTarget {
  workspaceId: string;
  tabId: string;
}

interface IDeepLinkActions {
  navigate: (workspaceId: string, tabId: string) => Promise<TNavigateToTabResult>;
  notifyWorkspaceNotFound: () => void;
  notifyTabNotFound: () => void;
}

export const parseDeepLinkTarget = (
  workspace: string | string[] | undefined,
  tab: string | string[] | undefined,
): IDeepLinkTarget | null => {
  if (typeof workspace !== 'string' || typeof tab !== 'string') return null;
  if (!workspace || !tab) return null;
  return { workspaceId: workspace, tabId: tab };
};

export const followDeepLink = async (
  target: IDeepLinkTarget,
  workspaceExists: boolean,
  actions: IDeepLinkActions,
): Promise<TNavigateToTabResult | 'workspace-not-found'> => {
  if (!workspaceExists) {
    actions.notifyWorkspaceNotFound();
    return 'workspace-not-found';
  }

  const result = await actions.navigate(target.workspaceId, target.tabId);
  if (result === 'not-found') actions.notifyTabNotFound();
  return result;
};

const useDeepLink = () => {
  const router = useRouter();
  const t = useTranslations('terminal');
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const workspacesLoading = useWorkspaceStore((state) => state.isLoading);
  const handledKeyRef = useRef<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);

  const target = useMemo(
    () => parseDeepLinkTarget(router.query.workspace, router.query.tab),
    [router.query.tab, router.query.workspace],
  );

  useEffect(() => {
    activeKeyRef.current = target ? JSON.stringify([target.workspaceId, target.tabId]) : null;
  }, [target]);

  useEffect(() => {
    if (!router.isReady || !target || workspacesLoading) return;

    const key = JSON.stringify([target.workspaceId, target.tabId]);
    if (handledKeyRef.current === key) return;

    handledKeyRef.current = key;
    followDeepLink(
      target,
      workspaces.some((workspace) => workspace.id === target.workspaceId),
      {
        navigate: navigateToTab,
        notifyWorkspaceNotFound: () => {
          if (activeKeyRef.current === key) {
            toast.error(t('deepLinkWorkspaceNotFound', { workspaceId: target.workspaceId }));
          }
        },
        notifyTabNotFound: () => {
          if (activeKeyRef.current === key) {
            toast.error(t('deepLinkTabNotFound', { tabId: target.tabId }));
          }
        },
      },
    ).catch(() => {
      // Layout errors are surfaced by the existing layout state.
    });
  }, [
    router.isReady,
    t,
    target,
    workspaces,
    workspacesLoading,
  ]);
};

export default useDeepLink;
