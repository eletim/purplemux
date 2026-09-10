import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import AgentStatusGlyph from '@/components/features/workspace/agent-status-glyph';
import { selectTabDisplayStatus, type ITabState } from '@/hooks/use-tab-store';
import type { TTabDisplayStatus } from '@/types/status';

const renderGlyph = (status: TTabDisplayStatus) =>
  renderToStaticMarkup(createElement(AgentStatusGlyph, { status, showIdle: true }));

describe('Mulmo session status surfaces', () => {
  it.each([
    ['busy', 'animate-spin', 'statusBusy'],
    ['needs-input', 'lucide-triangle-alert', 'statusNeedsInput'],
    ['ready-for-review', 'lucide-circle-check', 'statusNeedsReview'],
  ] as const)('renders an accessible shape for %s', (status, iconClass, label) => {
    const tabs = { tab: { cliState: status } as ITabState };
    const displayStatus = selectTabDisplayStatus(tabs, 'tab');
    const html = renderGlyph(displayStatus);

    expect(displayStatus).toBe(status);
    expect(html).toContain(`data-agent-status="${status}"`);
    expect(html).toContain('role="status"');
    expect(html).toContain(iconClass);
    expect(html).toContain(`<span class="sr-only">${label}</span>`);
  });

  it('retains the original spinner and dot presentation for Default mode', () => {
    expect(renderGlyph('busy')).toMatch(/agent-status-glyph-default[^>]*>.*animate-spin/);
    expect(renderGlyph('needs-input')).toMatch(/agent-status-glyph-default[^>]*>.*rounded-full bg-ui-amber/);
    expect(renderGlyph('ready-for-review')).toMatch(/agent-status-glyph-default[^>]*>.*rounded-full bg-claude-active/);
    expect(renderToStaticMarkup(createElement(AgentStatusGlyph, {
      status: 'busy',
      compact: true,
      showIdle: true,
    }))).toContain('h-2 w-2 text-muted-foreground');
  });

  it('maps Mulmo working, input, and completion states to blue, amber, and green', () => {
    const cssPath = fileURLToPath(new URL('../../../src/styles/globals.css', import.meta.url));
    const css = readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/data-agent-status="busy"[^}]+var\(--ui-blue\)/);
    expect(css).toMatch(/data-agent-status="needs-input"[^}]+var\(--ui-amber\)/);
    expect(css).toMatch(/data-agent-status="ready-for-review"[^}]+var\(--ui-green\)/);
    expect(css).toMatch(/data-ui-pane-status="ready-for-review"[^}]+var\(--ui-green\)/);
    expect(css).toMatch(/data-ui-mode="mulmo"[^}]+agent-status-glyph-default[^}]+display: none/);
    expect(css).toMatch(/data-ui-mode="mulmo"[^}]+agent-status-glyph-mulmo[^}]+display: inline-flex/);
  });
});
