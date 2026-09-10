import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
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

interface IDeepLinkState {
  isResolving: boolean;
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
  const handledKeyRef = useRef<string | null>(null);
  const [handledKey, setHandledKey] = useState<string | null>(null);
  const notifyWorkspaceNotFound = useEffectEvent((target: IDeepLinkTarget, key: string) => {
    toast.error(t('deepLinkWorkspaceNotFound', { workspaceId: target.workspaceId }), {
      id: `deep-link-workspace-${key}`,
    });
  });
  const notifyTabNotFound = useEffectEvent((target: IDeepLinkTarget, key: string) => {
    toast.error(t('deepLinkTabNotFound', { tabId: target.tabId }), {
      id: `deep-link-tab-${key}`,
    });
  });

  const target = useMemo(
    () => parseDeepLinkTarget(router.query.workspace, router.query.tab),
    [router.query.tab, router.query.workspace],
  );
  const key = target ? JSON.stringify([target.workspaceId, target.tabId]) : null;

  useEffect(() => {
    if (!router.isReady) return;
    if (!target || !key) return;
    if (handledKeyRef.current === key) return;

    const controller = new AbortController();
    let active = true;

    const run = async () => {
      if (useWorkspaceStore.getState().isLoading) {
        await new Promise<void>((resolve) => {
          let settled = false;
          let unsubscribe = () => {};
          const finish = () => {
            if (settled) return;
            settled = true;
            unsubscribe();
            controller.signal.removeEventListener('abort', finish);
            resolve();
          };
          unsubscribe = useWorkspaceStore.subscribe((state) => {
            if (!state.isLoading) finish();
          });
          controller.signal.addEventListener('abort', finish, { once: true });
          if (!useWorkspaceStore.getState().isLoading) finish();
        });
      }
      if (controller.signal.aborted) return;

      const workspaceExists = useWorkspaceStore.getState().workspaces
        .some((workspace) => workspace.id === target.workspaceId);
      await followDeepLink(
        target,
        workspaceExists,
        {
          navigate: (workspaceId, tabId) => navigateToTab(workspaceId, tabId, {
            signal: controller.signal,
            readOnly: true,
          }),
          notifyWorkspaceNotFound: () => {
            if (active) notifyWorkspaceNotFound(target, key);
          },
          notifyTabNotFound: () => {
            if (active) notifyTabNotFound(target, key);
          },
        },
      );
    };

    run().catch(() => {
      // Layout errors are surfaced by the existing layout state.
    }).finally(() => {
      if (active) {
        handledKeyRef.current = key;
        setHandledKey(key);
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [key, router.isReady, target]);

  return {
    isResolving: !router.isReady
      || (!!key && handledKey !== key),
  } satisfies IDeepLinkState;
};

export default useDeepLink;
