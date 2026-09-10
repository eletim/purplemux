import { beforeEach, describe, expect, it, vi } from 'vitest';
import useUiMode from '@/hooks/use-ui-mode';
import {
  createUiModeInitScript,
  DEFAULT_UI_MODE,
  UI_MODE_ATTRIBUTE,
  UI_MODE_STORAGE_KEY,
  applyUiMode,
  resolveUiMode,
  shouldDismissViewedStatus,
} from '@/lib/ui-mode';

describe('UI mode', () => {
  beforeEach(() => {
    useUiMode.setState({ mode: DEFAULT_UI_MODE, hydrated: false });
    vi.unstubAllGlobals();
  });

  it('resolves missing and unknown persisted values to Default', () => {
    expect(resolveUiMode(null)).toBe(DEFAULT_UI_MODE);
    expect(resolveUiMode('unknown')).toBe(DEFAULT_UI_MODE);
  });

  it('preserves the Mulmo selection', () => {
    expect(resolveUiMode('mulmo')).toBe('mulmo');
  });

  it('applies the selected mode to the app root attribute', () => {
    const setAttribute = vi.fn();

    applyUiMode({ setAttribute }, 'mulmo');

    expect(setAttribute).toHaveBeenCalledWith(UI_MODE_ATTRIBUTE, 'mulmo');
  });

  it('hydrates the store from persisted mode and only reads storage once', () => {
    const getItem = vi.fn(() => 'mulmo');
    vi.stubGlobal('window', { localStorage: { getItem } });

    useUiMode.getState().hydrate();
    useUiMode.getState().hydrate();

    expect(getItem).toHaveBeenCalledOnce();
    expect(getItem).toHaveBeenCalledWith(UI_MODE_STORAGE_KEY);
    expect(useUiMode.getState()).toMatchObject({ mode: 'mulmo', hydrated: true });
  });

  it('persists mode changes while keeping the in-page mode when storage fails', () => {
    const setItem = vi.fn(() => {
      throw new Error('storage unavailable');
    });
    vi.stubGlobal('window', { localStorage: { setItem } });

    useUiMode.getState().setMode('mulmo');

    expect(setItem).toHaveBeenCalledWith(UI_MODE_STORAGE_KEY, 'mulmo');
    expect(useUiMode.getState()).toMatchObject({ mode: 'mulmo', hydrated: true });
  });

  it.each([
    ['mulmo', 'mulmo'],
    ['default', DEFAULT_UI_MODE],
    ['unexpected', DEFAULT_UI_MODE],
  ])('hydrates the root before React for persisted value %s', (persisted, expected) => {
    const setAttribute = vi.fn();
    const runInitScript = new Function('localStorage', 'document', createUiModeInitScript());

    runInitScript(
      { getItem: vi.fn(() => persisted) },
      { documentElement: { setAttribute } },
    );

    expect(setAttribute).toHaveBeenCalledWith(UI_MODE_ATTRIBUTE, expected);
  });

  it('hydrates the root to Default when browser storage is unavailable', () => {
    const setAttribute = vi.fn();
    const runInitScript = new Function('localStorage', 'document', createUiModeInitScript());

    runInitScript(
      { getItem: () => { throw new Error('storage unavailable'); } },
      { documentElement: { setAttribute } },
    );

    expect(setAttribute).toHaveBeenCalledWith(UI_MODE_ATTRIBUTE, DEFAULT_UI_MODE);
  });

  it('preserves viewed completion attention in Mulmo mode', () => {
    expect(shouldDismissViewedStatus('mulmo', true)).toBe(false);
    expect(shouldDismissViewedStatus('default', true)).toBe(true);
    expect(shouldDismissViewedStatus('default', false)).toBe(false);
  });
});
