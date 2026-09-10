import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UI_MODE,
  UI_MODE_ATTRIBUTE,
  applyUiMode,
  resolveUiMode,
  shouldDismissViewedStatus,
} from '@/lib/ui-mode';

describe('UI mode', () => {
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

  it('preserves viewed completion attention in Mulmo mode', () => {
    expect(shouldDismissViewedStatus('mulmo', true)).toBe(false);
    expect(shouldDismissViewedStatus('default', true)).toBe(true);
    expect(shouldDismissViewedStatus('default', false)).toBe(false);
  });
});
