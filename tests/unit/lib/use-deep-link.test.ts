import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  const refs: Array<{ current: unknown }> = [];
  const states: unknown[] = [];
  const memos: Array<{ deps: unknown[]; value: unknown }> = [];
  const effects: Array<{
    deps: unknown[];
    cleanup?: () => void;
    pending?: () => void | (() => void);
  }> = [];
  let refCursor = 0;
  let stateCursor = 0;
  let memoCursor = 0;
  let effectCursor = 0;
  const sameDeps = (left: unknown[] | undefined, right: unknown[]) =>
    !!left && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

  return {
    reset() {
      refs.length = 0;
      states.length = 0;
      memos.length = 0;
      effects.splice(0).forEach((effect) => effect.cleanup?.());
      this.beginRender();
    },
    beginRender() {
      refCursor = 0;
      stateCursor = 0;
      memoCursor = 0;
      effectCursor = 0;
    },
    useRef<T>(initial: T) {
      const index = refCursor++;
      refs[index] ??= { current: initial };
      return refs[index] as { current: T };
    },
    useState<T>(initial: T) {
      const index = stateCursor++;
      if (states.length <= index) states[index] = initial;
      return [states[index] as T, (value: T) => { states[index] = value; }] as const;
    },
    useMemo<T>(factory: () => T, deps: unknown[]) {
      const index = memoCursor++;
      if (!memos[index] || !sameDeps(memos[index].deps, deps)) {
        memos[index] = { deps, value: factory() };
      }
      return memos[index].value as T;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = effectCursor++;
      const current = effects[index];
      if (!current || !sameDeps(current.deps, deps)) {
        effects[index] = { deps, cleanup: current?.cleanup, pending: effect };
      }
    },
    flushEffects() {
      for (const effect of effects) {
        if (!effect.pending) continue;
        effect.cleanup?.();
        const pending = effect.pending;
        effect.pending = undefined;
        effect.cleanup = pending() ?? undefined;
      }
    },
  };
});

const router = vi.hoisted(() => ({
  isReady: true,
  query: { workspace: 'ws-target', tab: 'target-tab' } as Record<string, string>,
}));
const workspaceState = vi.hoisted(() => ({
  isLoading: false,
  activeWorkspaceId: 'ws-current',
  workspaces: [{ id: 'ws-target' }],
}));
const workspaceSubscribers = vi.hoisted(() => new Set<(state: typeof workspaceState) => void>());
const navigateToTab = vi.hoisted(() => vi.fn(async () => 'focused' as const));
const setProtectedLayoutWorkspaceId = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const translation = vi.hoisted(() => ({ current: vi.fn((key: string) => key) }));

vi.mock('react', () => ({
  useEffect: hooks.useEffect,
  useEffectEvent: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  useMemo: hooks.useMemo,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next-intl', () => ({ useTranslations: () => translation.current }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));
vi.mock('@/hooks/use-workspace-store', () => ({
  default: {
    getState: () => workspaceState,
    subscribe: (subscriber: (state: typeof workspaceState) => void) => {
      workspaceSubscribers.add(subscriber);
      return () => workspaceSubscribers.delete(subscriber);
    },
  },
}));
vi.mock('@/hooks/use-layout', () => ({
  navigateToTab,
  useLayoutStore: {
    getState: () => ({ setProtectedLayoutWorkspaceId }),
  },
}));

import useDeepLink from '@/hooks/use-deep-link';

const useTestDeepLink = () => {
  hooks.beginRender();
  const result = useDeepLink();
  hooks.flushEffects();
  return result;
};

describe('useDeepLink', () => {
  beforeEach(() => {
    hooks.reset();
    router.isReady = true;
    router.query = { workspace: 'ws-target', tab: 'target-tab' };
    workspaceState.isLoading = false;
    workspaceState.activeWorkspaceId = 'ws-current';
    workspaceState.workspaces = [{ id: 'ws-target' }];
    workspaceSubscribers.clear();
    navigateToTab.mockClear();
    setProtectedLayoutWorkspaceId.mockClear();
    toastError.mockClear();
  });

  it('consumes a URL target once and does not reactivate it after unrelated rerenders', async () => {
    expect(useTestDeepLink()).toEqual({
      isResolving: true,
      resolvedLayoutWorkspaceId: null,
    });
    expect(navigateToTab).toHaveBeenCalledOnce();
    expect(navigateToTab).toHaveBeenCalledWith('ws-target', 'target-tab', expect.objectContaining({
      readOnly: true,
    }));

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(useTestDeepLink()).toEqual({
      isResolving: false,
      resolvedLayoutWorkspaceId: 'ws-target',
    });

    workspaceState.activeWorkspaceId = 'ws-current';
    workspaceState.workspaces = [{ id: 'ws-target' }, { id: 'ws-new' }];
    translation.current = vi.fn((key: string) => `updated-${key}`);
    expect(useTestDeepLink()).toEqual({
      isResolving: false,
      resolvedLayoutWorkspaceId: 'ws-target',
    });
    expect(navigateToTab).toHaveBeenCalledOnce();
  });

  it('handles the same canonical link again after the URL parameters are removed', async () => {
    useTestDeepLink();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(useTestDeepLink().isResolving).toBe(false);

    router.query = {};
    expect(useTestDeepLink()).toEqual({
      isResolving: false,
      resolvedLayoutWorkspaceId: null,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    useTestDeepLink();
    expect(setProtectedLayoutWorkspaceId).toHaveBeenCalledWith(null);

    router.query = { workspace: 'ws-target', tab: 'target-tab' };
    expect(useTestDeepLink()).toEqual({
      isResolving: true,
      resolvedLayoutWorkspaceId: null,
    });
    expect(navigateToTab).toHaveBeenCalledTimes(2);

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(useTestDeepLink()).toEqual({
      isResolving: false,
      resolvedLayoutWorkspaceId: 'ws-target',
    });
  });

  it('clears the previous protection when the next canonical link has no workspace', async () => {
    useTestDeepLink();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(useTestDeepLink()).toEqual({
      isResolving: false,
      resolvedLayoutWorkspaceId: 'ws-target',
    });

    setProtectedLayoutWorkspaceId.mockClear();
    router.query = { workspace: 'ws-missing', tab: 'missing-tab' };
    expect(useTestDeepLink()).toEqual({
      isResolving: true,
      resolvedLayoutWorkspaceId: null,
    });

    expect(setProtectedLayoutWorkspaceId).toHaveBeenCalledOnce();
    expect(setProtectedLayoutWorkspaceId).toHaveBeenCalledWith(null);
    expect(navigateToTab).toHaveBeenCalledOnce();

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(useTestDeepLink()).toEqual({
      isResolving: false,
      resolvedLayoutWorkspaceId: null,
    });
    expect(toastError).toHaveBeenCalledOnce();
    expect(navigateToTab).toHaveBeenCalledOnce();
  });
});
