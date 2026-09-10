import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cssPath = fileURLToPath(new URL('../../../src/styles/globals.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

const declarationsFor = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]+)\\}`));
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? '';
};

describe('UI mode theme boundaries', () => {
  it('keeps the Default light and dark palettes independent of UI mode', () => {
    expect(declarationsFor(':root')).toContain('--background: oklch(0.995 0.003 287)');
    expect(declarationsFor('.dark')).toContain('--background: oklch(0.07 0 0)');
    expect(declarationsFor(':root')).not.toContain('--mulmo-hover');
    expect(declarationsFor('.dark')).not.toContain('--mulmo-hover');
  });

  it('provides separate Mulmo palettes for light and dark themes', () => {
    const light = declarationsFor(':root[data-ui-mode="mulmo"]');
    const dark = declarationsFor(':root.dark[data-ui-mode="mulmo"]');

    expect(light).toContain('--background: #f4f6fb');
    expect(light).toContain('--terminal-bg: #ffffff');
    expect(dark).toContain('--background: #1a1a2e');
    expect(dark).toContain('--terminal-bg: #11111f');
  });

  it('scopes every Mulmo presentation rule to the root mode attribute', () => {
    const mulmoSection = css.slice(
      css.indexOf('/* Mulmo mode mirrors'),
      css.indexOf('@theme inline'),
    );
    const selectors = [...mulmoSection.matchAll(/(?:^|\n)([^\n{}]+) \{/g)]
      .map((match) => match[1].trim())
      .filter((selector) => selector.startsWith(':root'));

    expect(selectors.length).toBeGreaterThan(10);
    expect(selectors.every((selector) => selector.includes('[data-ui-mode="mulmo"]'))).toBe(true);
  });
});
