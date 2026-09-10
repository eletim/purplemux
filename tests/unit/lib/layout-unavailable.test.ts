import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LayoutUnavailable from '@/components/features/workspace/layout-unavailable';

describe('LayoutUnavailable', () => {
  it.each(['desktop', 'mobile'])('renders the missing-layout fallback on %s', (formFactor) => {
    const html = renderToStaticMarkup(createElement(LayoutUnavailable, {
      message: 'Failed to load layout',
      retryLabel: 'Retry',
      onRetry: vi.fn(),
      surface: formFactor as 'desktop' | 'mobile',
    }));

    expect(html).toContain(`data-layout-surface="${formFactor}"`);
    expect(html).toContain('data-layout-state="unavailable"');
    expect(html).toContain('Failed to load layout');
    expect(html).toContain('Retry');
  });

  it.each(['desktop', 'mobile'])('renders the failed-read message on %s', (formFactor) => {
    const html = renderToStaticMarkup(createElement(LayoutUnavailable, {
      message: 'Read failed',
      retryLabel: 'Retry',
      onRetry: vi.fn(),
      surface: formFactor as 'desktop' | 'mobile',
    }));

    expect(html).toContain(`data-layout-surface="${formFactor}"`);
    expect(html).toContain('data-layout-state="unavailable"');
    expect(html).toContain('Read failed');
    expect(html).toContain('Retry');
  });
});
