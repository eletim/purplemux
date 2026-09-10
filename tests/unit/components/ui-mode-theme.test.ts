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

const splitSelectorList = (selectorList: string): string[] => {
  const selectors: string[] = [];
  let parentheses = 0;
  let start = 0;

  for (let index = 0; index < selectorList.length; index++) {
    if (selectorList[index] === '(') parentheses++;
    if (selectorList[index] === ')') parentheses--;
    if (selectorList[index] === ',' && parentheses === 0) {
      selectors.push(selectorList.slice(start, index).trim());
      start = index + 1;
    }
  }

  selectors.push(selectorList.slice(start).trim());
  return selectors;
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
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = [...mulmoSection.matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .flatMap((match) => splitSelectorList(match[1]));
    const unscopedSelectors = selectors.filter((selector) => (
      !/^:root(?:\.dark)?\[data-ui-mode="mulmo"\](?=$|[\s:.#\[])/.test(selector)
    ));

    expect(selectors.length).toBeGreaterThan(10);
    expect(unscopedSelectors).toEqual([]);
  });
});
