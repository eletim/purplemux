// @vitest-environment jsdom

import { createElement, Fragment } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'next-themes';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomCssSync, UiModeSync } from '@/components/root-presentation-sync';
import UiModeControl from '@/components/features/workspace/ui-mode-control';
import useConfigStore from '@/hooks/use-config-store';
import useUiMode from '@/hooks/use-ui-mode';
import { CUSTOM_CSS_ELEMENT_ID } from '@/lib/custom-css';
import { DEFAULT_UI_MODE, UI_MODE_ATTRIBUTE, UI_MODE_STORAGE_KEY } from '@/lib/ui-mode';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('root presentation synchronization', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    document.documentElement.className = '';
    document.documentElement.removeAttribute(UI_MODE_ATTRIBUTE);
    document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.remove();
    localStorage.clear();
    useUiMode.setState({ mode: DEFAULT_UI_MODE, hydrated: false });
    useConfigStore.setState({ customCSS: ':root { --integration-accent: hotpink; }' });
  });

  afterEach(() => cleanup());

  it('switches the live root mode without disturbing next-themes or custom CSS', async () => {
    render(createElement(
      ThemeProvider,
      { attribute: 'class', forcedTheme: 'dark' },
      createElement(Fragment, null,
        createElement(UiModeSync),
        createElement(CustomCssSync),
        createElement(UiModeControl),
      ),
    ));

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.getAttribute(UI_MODE_ATTRIBUTE)).toBe('default');
    });

    fireEvent.click(screen.getByRole('button', { name: 'uiModeMulmo' }));

    await waitFor(() => expect(document.documentElement.getAttribute(UI_MODE_ATTRIBUTE)).toBe('mulmo'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem(UI_MODE_STORAGE_KEY)).toBe('mulmo');
    expect(document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.textContent)
      .toBe(':root { --integration-accent: hotpink; }');

    fireEvent.click(screen.getByRole('button', { name: 'uiModeDefault' }));

    await waitFor(() => expect(document.documentElement.getAttribute(UI_MODE_ATTRIBUTE)).toBe('default'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.textContent)
      .toBe(':root { --integration-accent: hotpink; }');
  });
});
