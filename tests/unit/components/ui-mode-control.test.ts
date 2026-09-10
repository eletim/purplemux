import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const uiModeState = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'mulmo',
  setMode: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/use-ui-mode', () => ({
  default: (selector: (state: typeof uiModeState) => unknown) => selector(uiModeState),
}));

import UiModeControl from '@/components/features/workspace/ui-mode-control';

const renderControl = () => renderToStaticMarkup(createElement(UiModeControl));

describe('UI mode control', () => {
  beforeEach(() => {
    uiModeState.mode = 'default';
    uiModeState.setMode.mockClear();
  });

  it('exposes the selected mode as pressed native buttons', () => {
    const html = renderControl();

    expect(html).toMatch(/role="group"[^>]*aria-label="uiMode"/);
    expect(html).toMatch(/<button(?=[^>]*type="button")(?=[^>]*aria-pressed="true")[^>]*>uiModeDefault<\/button>/);
    expect(html).toMatch(/<button(?=[^>]*type="button")(?=[^>]*aria-pressed="false")[^>]*>uiModeMulmo<\/button>/);
  });

  it('keeps mobile tap targets tall without changing the desktop height', () => {
    uiModeState.mode = 'mulmo';
    const html = renderControl();

    expect(html.match(/min-h-11 sm:min-h-7/g)).toHaveLength(2);
    expect(html).toMatch(/<button(?=[^>]*aria-pressed="true")[^>]*>uiModeMulmo<\/button>/);
  });
});
