import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notificationCounts = vi.hoisted(() => ({ attentionCount: 0, busyCount: 0 }));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/use-tab-store', () => ({
  default: () => false,
  selectGlobalStatus: () => ({ busyCount: 0 }),
}));

vi.mock('@/components/features/workspace/notification-sheet', () => ({
  useNotificationCount: () => notificationCounts,
}));

vi.mock('@/components/layout/app-logo', () => ({
  default: () => createElement('span', null, 'purplemux'),
}));

import AppHeader from '@/components/layout/app-header';

const renderHeader = () => renderToStaticMarkup(createElement(AppHeader, { onMenuOpen: () => {} }));

describe('Mulmo icon-button styling contract', () => {
  beforeEach(() => {
    notificationCounts.attentionCount = 0;
    notificationCounts.busyCount = 0;
  });

  it('explicitly targets marked icon buttons', () => {
    const cssPath = fileURLToPath(new URL('../../../src/styles/globals.css', import.meta.url));
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toContain(
      ':root[data-ui-mode="mulmo"] [data-ui-chrome] :is(button:has(> svg:only-child), [data-ui-icon-button])',
    );
  });

  it('marks the menu icon button without a notification badge', () => {
    const html = renderHeader();

    expect(html).toMatch(/<button(?=[^>]*data-ui-icon-button="")(?=[^>]*aria-label="openMenu")[^>]*>/);
  });

  it('keeps the menu icon button marked when a notification badge is present', () => {
    notificationCounts.attentionCount = 2;
    const html = renderHeader();

    expect(html).toMatch(/<button(?=[^>]*data-ui-icon-button="")(?=[^>]*aria-label="openMenu")[^>]*>/);
    expect(html).toContain('>2</span>');
  });
});
