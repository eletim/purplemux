// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  isShellPrompt,
  syncPromptMarkers,
  type ITerminalPromptLine,
} from '@/lib/terminal-prompt-marker';

const PROMPT_PREFIX = 'eletim@E-ryzen:';

const createBuffer = (rows: Array<string | { text: string; wrapped: boolean }>) => ({
  get length() { return rows.length; },
  getLine: (row: number): ITerminalPromptLine | undefined => {
    const value = rows[row];
    if (value === undefined) return undefined;
    const text = typeof value === 'string' ? value : value.text;
    return {
      isWrapped: typeof value === 'string' ? false : value.wrapped,
      translateToString: (trimRight = false) => trimRight ? text.trimEnd() : text,
    };
  },
});

describe('terminal prompt markers', () => {
  it('matches only the configured prompt prefix at the start of a line', () => {
    expect(isShellPrompt('eletim@E-ryzen:~$', PROMPT_PREFIX)).toBe(true);
    expect(isShellPrompt('eletim@E-ryzen:/srv/app# command', PROMPT_PREFIX)).toBe(true);
    expect(isShellPrompt('root@server:/srv/app#', PROMPT_PREFIX)).toBe(false);
    expect(isShellPrompt('  eletim@E-ryzen:~$ pnpm test', PROMPT_PREFIX)).toBe(true);
    expect(isShellPrompt('\u200beletim@E-ryzen:~$ pnpm test', PROMPT_PREFIX)).toBe(true);
    expect(isShellPrompt('eletim@E-ryzen:~$', '')).toBe(false);
    expect(isShellPrompt('build output: 100% done', PROMPT_PREFIX)).toBe(false);
  });

  it('renders circles only for visible prompt rows', () => {
    const gutter = document.createElement('div');
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ above',
      'above output',
      'eletim@E-ryzen:~$',
      { text: 'wrapped output', wrapped: true },
      'eletim@E-ryzen:~/purplemux$ visible',
      'eletim@E-ryzen:~$ below',
    ]);

    syncPromptMarkers({
      gutter,
      buffer,
      viewportY: 2,
      viewportRows: 3,
      screenTop: 4,
      screenHeight: 60,
      promptPrefix: PROMPT_PREFIX,
    });

    const markers = [...gutter.querySelectorAll<HTMLElement>('.terminal-prompt-marker')];
    expect(markers.map((marker) => marker.dataset.bufferRow)).toEqual(['2', '4']);
    expect(markers.map((marker) => [marker.style.top, marker.style.height])).toEqual([
      ['4px', '20px'],
      ['44px', '20px'],
    ]);
    expect(gutter.querySelector('button')).toBeNull();
  });

  it('updates visible circles after viewport and geometry changes', () => {
    const gutter = document.createElement('div');
    const rows = [
      'plain output',
      'eletim@E-ryzen:~$ first',
      'plain output',
      'eletim@E-ryzen:~$ second',
      'plain output',
    ];
    const buffer = createBuffer(rows);
    const sync = (viewportY: number, screenTop: number, screenHeight: number) => {
      syncPromptMarkers({
        gutter,
        buffer,
        viewportY,
        viewportRows: 3,
        screenTop,
        screenHeight,
        promptPrefix: PROMPT_PREFIX,
      });
    };

    sync(0, 4, 60);
    expect(gutter.querySelector<HTMLElement>('[data-buffer-row="1"]')?.style.top).toBe('24px');

    sync(2, 4, 60);
    expect(gutter.querySelector('[data-buffer-row="1"]')).toBeNull();
    expect(gutter.querySelector<HTMLElement>('[data-buffer-row="3"]')?.style.top).toBe('24px');

    sync(2, 2, 75);
    const resized = gutter.querySelector<HTMLElement>('[data-buffer-row="3"]');
    expect(resized?.style.top).toBe('27px');
    expect(resized?.style.height).toBe('25px');

    rows[4] = 'eletim@E-ryzen:~$ written';
    sync(2, 2, 75);
    expect(gutter.querySelector('[data-buffer-row="4"]')).not.toBeNull();
  });

  it('removes stale circles when the buffer is reset', () => {
    const gutter = document.createElement('div');
    const rows = ['eletim@E-ryzen:~$ command'];
    const buffer = createBuffer(rows);
    const sync = () => syncPromptMarkers({
      gutter,
      buffer,
      viewportY: 0,
      viewportRows: 3,
      screenTop: 0,
      screenHeight: 60,
      promptPrefix: PROMPT_PREFIX,
    });

    sync();
    expect(gutter.querySelector('.terminal-prompt-marker')).not.toBeNull();

    rows.length = 0;
    sync();
    expect(gutter.querySelector('.terminal-prompt-marker')).toBeNull();
  });
});
