import { useEffect, useMemo } from 'react';
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

  const target = useMemo(
    () => parseDeepLinkTarget(router.query.workspace, router.query.tab),
    [router.query.tab, router.query.workspace],
  );
  const workspaceExists = target
    ? workspaces.some((workspace) => workspace.id === target.workspaceId)
    : false;

  useEffect(() => {
    if (!router.isReady || !target || workspacesLoading) return;

    const key = JSON.stringify([target.workspaceId, target.tabId]);
    const controller = new AbortController();
    let active = true;

    followDeepLink(
      target,
      workspaceExists,
      {
        navigate: (workspaceId, tabId) => navigateToTab(workspaceId, tabId, {
          signal: controller.signal,
          readOnly: true,
        }),
        notifyWorkspaceNotFound: () => {
          if (active) {
            toast.error(t('deepLinkWorkspaceNotFound', { workspaceId: target.workspaceId }), {
              id: `deep-link-workspace-${key}`,
            });
          }
        },
        notifyTabNotFound: () => {
          if (active) {
            toast.error(t('deepLinkTabNotFound', { tabId: target.tabId }), {
              id: `deep-link-tab-${key}`,
            });
          }
        },
      },
    ).catch(() => {
      // Layout errors are surfaced by the existing layout state.
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    router.isReady,
    t,
    target,
    workspaceExists,
    workspacesLoading,
  ]);

  return target;
};

export default useDeepLink;
