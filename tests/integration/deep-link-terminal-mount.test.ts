import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData } from '@/types/terminal';

const hooks = vi.hoisted(() => {
  const refs: Array<{ current: unknown }> = [];
  const effects: Array<() => void | (() => void)> = [];
  let refCursor = 0;

  return {
    reset() {
      refs.length = 0;
      effects.length = 0;
      refCursor = 0;
    },
    useRef<T>(initial: T) {
      const index = refCursor++;
      refs[index] ??= { current: initial };
      return refs[index] as { current: T };
    },
    useEffect(effect: () => void | (() => void)) {
      effects.push(effect);
    },
    flushEffects() {
      effects.splice(0).forEach((effect) => effect());
    },
  };
});

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: <T>(callback: T) => callback,
    useDebugValue: () => {},
    useEffect: hooks.useEffect,
    useRef: hooks.useRef,
    useSyncExternalStore: <T>(
      _subscribe: (listener: () => void) => () => void,
      getSnapshot: () => T,
    ) => getSnapshot(),
  };
});
vi.mock('next/router', () => ({ default: { pathname: '/' } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock('zustand/react/shallow', () => ({ useShallow: <T>(selector: T) => selector }));
vi.mock('zustand', () => ({
  create: <T>(initializer: (
    set: (update: Partial<T> | ((state: T) => Partial<T>)) => void,
    get: () => T,
  ) => T) => {
    let state: T;
    const listeners = new Set<(state: T, previous: T) => void>();
    const get = () => state;
    const set = (update: Partial<T> | ((current: T) => Partial<T>)) => {
      const previous = state;
      const patch = typeof update === 'function' ? update(state) : update;
      state = { ...state, ...patch };
      listeners.forEach((listener) => listener(state, previous));
    };
    state = initializer(set, get);
    const store = (selector: (current: T) => unknown) => selector(state);
    store.getState = get;
    store.setState = set;
    store.subscribe = (listener: (current: T, previous: T) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    return store;
  },
}));

import useLayout, { useLayoutStore } from '@/hooks/use-layout';

const existingLayout: ILayoutData = {
  root: {
    type: 'pane',
    id: 'pane-target',
    tabs: [{ id: 'tab-target', sessionName: 'session-target', name: '', order: 0 }],
    activeTabId: 'tab-target',
  },
  activePaneId: 'pane-target',
  updatedAt: '2026-09-11T00:00:00.000Z',
};

const useMountedLayout = (
  error: string | null,
  layout: ILayoutData | null,
  initialLayoutWorkspaceId: string | null = 'ws-target',
) => {
  useLayoutStore.setState({
    workspaceId: 'ws-target',
    layout,
    isLoading: false,
    error,
    pendingFocusTabId: null,
  });
  useLayout({
    workspaceId: 'ws-target',
    initialLayoutWorkspaceId,
  });
  hooks.flushEffects();
};

describe('deep-link terminal mount', () => {
  beforeEach(() => {
    hooks.reset();
    vi.stubGlobal('fetch', vi.fn());
  });

  it.each([
    ['an existing layout', null, existingLayout],
    ['a missing layout', null, null],
    ['a failed layout read', 'Unable to load layout', null],
  ])('does not follow the completed read-only result with a restorative GET for %s', (
    _case,
    error,
    layout,
  ) => {
    useMountedLayout(error, layout);

    expect(fetch).not.toHaveBeenCalled();
    expect(useLayoutStore.getState()).toMatchObject({
      workspaceId: 'ws-target',
      layout,
      error,
    });
  });

  it('retains the ordinary initial layout fetch without a completed deep-link result', () => {
    useMountedLayout(null, null, null);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      '/api/layout?workspace=ws-target',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
