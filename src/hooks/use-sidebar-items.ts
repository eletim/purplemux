import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

interface ISidebarItem {
  id: string;
  name: string;
  icon: string;
  url: string;
  enabled: boolean;
}

interface ISidebarItemsData {
  builtins: ISidebarItem[];
  custom: ISidebarItem[];
  order: string[];
}

interface IUseSidebarItemsReturn {
  items: ISidebarItem[];
  allOrderedItems: ISidebarItem[];
  builtinItems: ISidebarItem[];
  customItems: ISidebarItem[];
  order: string[];
  isLoading: boolean;
  toggleBuiltin: (id: string, enabled: boolean) => Promise<void>;
  saveCustom: (items: ISidebarItem[]) => Promise<void>;
  saveOrder: (order: string[]) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error('fetch failed');
    return res.json() as Promise<ISidebarItemsData>;
  });

const EMPTY: ISidebarItemsData = { builtins: [], custom: [], order: [] };

const applyOrder = <T extends { id: string }>(items: T[], order: string[]): T[] => {
  if (order.length === 0) return items;
  const map = new Map(items.map((i) => [i.id, i]));
  const ordered: T[] = [];
  for (const id of order) {
    const item = map.get(id);
    if (item) {
      ordered.push(item);
      map.delete(id);
    }
  }
  for (const item of map.values()) {
    ordered.push(item);
  }
  return ordered;
};

const useSidebarItems = (enabled = true): IUseSidebarItemsReturn => {
  const { data, isLoading, mutate } = useSWR(enabled ? '/api/sidebar-items' : null, fetcher, {
    revalidateOnFocus: false,
  });

  const safeData = data ?? EMPTY;

  const items = useMemo(
    () => applyOrder([...safeData.builtins, ...safeData.custom].filter((i) => i.enabled), safeData.order),
    [safeData],
  );

  const allOrderedItems = useMemo(
    () => applyOrder([...safeData.builtins, ...safeData.custom], safeData.order),
    [safeData],
  );

  const persist = useCallback(async (builtins: ISidebarItem[], custom: ISidebarItem[], order: string[]) => {
    const disabledBuiltinIds = builtins.filter((b) => !b.enabled).map((b) => b.id);
    const res = await fetch('/api/sidebar-items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom, disabledBuiltinIds, order }),
    });
    if (!res.ok) throw new Error('save failed');
  }, []);

  const toggleBuiltin = useCallback(
    async (id: string, enabled: boolean) => {
      const update = (prev: ISidebarItemsData) => ({
        ...prev,
        builtins: prev.builtins.map((b) => (b.id === id ? { ...b, enabled } : b)),
      });
      await mutate(
        async (current) => {
          const prev = current ?? EMPTY;
          const next = update(prev);
          await persist(next.builtins, next.custom, next.order);
          return next;
        },
        { optimisticData: (current) => update(current ?? EMPTY), rollbackOnError: true, revalidate: false },
      ).catch(() => toast.error(t('settings', 'saveFailed')));
    },
    [mutate, persist],
  );

  const saveCustom = useCallback(
    async (custom: ISidebarItem[]) => {
      const update = (prev: ISidebarItemsData) => ({ ...prev, custom });
      await mutate(
        async (current) => {
          const prev = current ?? EMPTY;
          const next = update(prev);
          await persist(next.builtins, next.custom, next.order);
          return next;
        },
        { optimisticData: (current) => update(current ?? EMPTY), rollbackOnError: true, revalidate: false },
      ).catch(() => toast.error(t('settings', 'saveFailed')));
    },
    [mutate, persist],
  );

  const saveOrder = useCallback(
    async (order: string[]) => {
      const update = (prev: ISidebarItemsData) => ({ ...prev, order });
      await mutate(
        async (current) => {
          const prev = current ?? EMPTY;
          const next = update(prev);
          await persist(next.builtins, next.custom, next.order);
          return next;
        },
        { optimisticData: (current) => update(current ?? EMPTY), rollbackOnError: true, revalidate: false },
      ).catch(() => toast.error(t('settings', 'saveFailed')));
    },
    [mutate, persist],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      const update = (prev: ISidebarItemsData) => ({
        ...prev,
        custom: prev.custom.filter((i) => i.id !== id),
        order: prev.order.filter((oid) => oid !== id),
      });
      await mutate(
        async (current) => {
          const prev = current ?? EMPTY;
          const next = update(prev);
          await persist(next.builtins, next.custom, next.order);
          return next;
        },
        { optimisticData: (current) => update(current ?? EMPTY), rollbackOnError: true, revalidate: false },
      ).catch(() => toast.error(t('settings', 'saveFailed')));
    },
    [mutate, persist],
  );

  const resetAll = useCallback(async () => {
    const update = (prev: ISidebarItemsData) => ({
      builtins: prev.builtins.map((b) => ({ ...b, enabled: true })),
      custom: [],
      order: [],
    });
    await mutate(
      async (current) => {
        const prev = current ?? EMPTY;
        const next = update(prev);
        await persist(next.builtins, next.custom, next.order);
        return next;
      },
      { optimisticData: (current) => update(current ?? EMPTY), rollbackOnError: true, revalidate: false },
    ).catch(() => toast.error(t('settings', 'saveFailed')));
  }, [mutate, persist]);

  return {
    items,
    allOrderedItems,
    builtinItems: safeData.builtins,
    customItems: safeData.custom,
    order: safeData.order,
    isLoading,
    toggleBuiltin,
    saveCustom,
    saveOrder,
    deleteItem,
    resetAll,
  };
};

export default useSidebarItems;
export type { ISidebarItem };
