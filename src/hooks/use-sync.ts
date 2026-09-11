import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import { useLayoutStore, collectPanes } from '@/hooks/use-layout';
import useTabStore from '@/hooks/use-tab-store';
import useWorkspaceLayoutStore from '@/hooks/use-workspace-layout-store';
import type { ILayoutData } from '@/types/terminal';

const RECONNECT_DELAY = 3000;

const fetchLayoutForSync = (workspaceId: string) => {
  const layoutStore = useLayoutStore.getState();
  return layoutStore.fetchLayout(workspaceId, undefined, {
    readOnly: layoutStore.protectedLayoutWorkspaceId === workspaceId,
  });
};

const layoutUrlForSync = (workspaceId: string): string => {
  const readOnly = useLayoutStore.getState().protectedLayoutWorkspaceId === workspaceId;
  return `/api/layout?workspace=${workspaceId}${readOnly ? '&readOnly=true' : ''}`;
};

type TToastVariant = 'info' | 'success' | 'warning' | 'error';
type TSystemToastAction = { kind: 'copy'; label: string; text: string; successMessage?: string };

const SEEN_TOAST_STORAGE_KEY = 'pmux-seen-system-toasts';
const seenToastKeys = new Set<string>();

if (typeof window !== 'undefined') {
  try {
    const stored = window.sessionStorage.getItem(SEEN_TOAST_STORAGE_KEY);
    if (stored) JSON.parse(stored).forEach((key: string) => seenToastKeys.add(key));
  } catch {
    // ignore parse / quota errors
  }
}

const persistSeenToasts = () => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SEEN_TOAST_STORAGE_KEY, JSON.stringify([...seenToastKeys]));
  } catch {
    // sessionStorage may be disabled — dedup falls back to in-memory only
  }
};

const buildToastAction = (action: TSystemToastAction | undefined) => {
  if (!action) return undefined;
  if (action.kind !== 'copy') return undefined;
  return {
    label: action.label,
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(action.text);
        if (action.successMessage) toast.success(action.successMessage);
      } catch {
        toast.error('클립보드 복사에 실패했습니다');
      }
    },
  };
};

const showSystemToast = (
  key: string,
  variant: TToastVariant,
  message: string,
  durationMs?: number,
  action?: TSystemToastAction,
) => {
  if (seenToastKeys.has(key)) return;
  seenToastKeys.add(key);
  persistSeenToasts();
  const opts = { id: key, duration: durationMs, action: buildToastAction(action) };
  if (variant === 'warning') toast.warning(message, opts);
  else if (variant === 'error') toast.error(message, opts);
  else if (variant === 'success') toast.success(message, opts);
  else toast.info(message, opts);
};

const isSystemToastAction = (v: unknown): v is TSystemToastAction => {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return obj.kind === 'copy' && typeof obj.label === 'string' && typeof obj.text === 'string';
};

const useSync = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    const connect = () => {
      if (!mountedRef.current) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/api/sync`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'workspace') {
            useWorkspaceStore.getState().syncWorkspaces();
          }

          if (data.type === 'system-toast' && typeof data.key === 'string' && typeof data.message === 'string') {
            const variant = (data.variant as TToastVariant) ?? 'info';
            const duration = typeof data.durationMs === 'number' ? data.durationMs : undefined;
            const action = isSystemToastAction(data.action) ? data.action : undefined;
            showSystemToast(data.key, variant, data.message, duration, action);
          }

          if (data.type === 'layout') {
            const activeWsId = useWorkspaceStore.getState().activeWorkspaceId;
            if (activeWsId && data.workspaceId === activeWsId) {
              fetchLayoutForSync(activeWsId);
            } else if (data.workspaceId) {
              fetch(layoutUrlForSync(data.workspaceId))
                .then((res) => (res.ok ? res.json() : null))
                .then((layout: ILayoutData | null) => {
                  if (!layout?.root) return;
                  useWorkspaceLayoutStore.getState().setLayout(data.workspaceId, layout);
                  const tabIds = collectPanes(layout.root).flatMap((p) => p.tabs.map((t) => t.id));
                  useTabStore.getState().setTabOrder(data.workspaceId, tabIds);
                })
                .catch(() => {});
            }
          }
        } catch (err) {
          console.log(`[sync-ws] message parse error: ${err instanceof Error ? err.message : err}`);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (mountedRef.current) {
          timerRef.current = setTimeout(connect, RECONNECT_DELAY);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      useWorkspaceStore.getState().syncWorkspaces();
      const activeWsId = useWorkspaceStore.getState().activeWorkspaceId;
      if (activeWsId) {
        fetchLayoutForSync(activeWsId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
};

export default useSync;
