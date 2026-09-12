// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  findShellPromptRows,
  getPromptBlockText,
  isShellPrompt,
  syncPromptCopyButtons,
  type ITerminalPromptBuffer,
  type ITerminalPromptLine,
} from '@/lib/terminal-prompt-copy';

const createBuffer = (
  rows: Array<string | { text: string; wrapped: boolean }>,
  type: 'normal' | 'alternate' = 'normal',
) => ({
  type,
  length: rows.length,
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

describe('terminal prompt copy boundaries', () => {
  it('recognizes common prompt forms without matching ordinary output', () => {
    expect(isShellPrompt('eletim@E-ryzen:~$')).toBe(true);
    expect(isShellPrompt('eletim@E-ryzen:~$ pnpm test')).toBe(true);
    expect(isShellPrompt('root@server:/srv/app#')).toBe(true);
    expect(isShellPrompt('~/purplemux % git status')).toBe(true);
    expect(isShellPrompt('$ echo hello')).toBe(true);
    expect(isShellPrompt('  eletim@E-ryzen:~$ pnpm test')).toBe(true);
    expect(isShellPrompt('\u200beletim@E-ryzen:~$ pnpm test')).toBe(true);
    expect(isShellPrompt('# a comment from a displayed config file')).toBe(false);
    expect(isShellPrompt('# Markdown heading')).toBe(false);
    expect(isShellPrompt('build output: 100% done')).toBe(false);
    expect(isShellPrompt('https://example.com/$value')).toBe(false);
  });

  it('finds prompt rows from the complete buffer', () => {
    const buffer = createBuffer([
      'old scrollback',
      'eletim@E-ryzen:~$ first',
      'first output',
      'eletim@E-ryzen:~/purplemux$ second',
    ]);

    expect(findShellPromptRows(buffer)).toEqual([1, 3]);
  });

  it('limits prompt detection to the requested tail of the buffer', () => {
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ old',
      'old output',
      'eletim@E-ryzen:~$ recent',
      'recent output',
    ]);

    expect(findShellPromptRows(buffer, 2)).toEqual([2]);
  });

  it('does not read the stable prefix during a tail scan', () => {
    let reads = 0;
    const buffer: ITerminalPromptBuffer = {
      length: 5000,
      getLine: (row) => {
        reads++;
        if (row < 0 || row >= 5000) return undefined;
        const text = row === 4998 ? 'eletim@E-ryzen:~$ recent' : '';
        return { isWrapped: false, translateToString: () => text };
      },
    };

    expect(findShellPromptRows(buffer, 4975)).toEqual([4998]);
    expect(reads).toBeLessThan(100);
  });

  it('copies through the row before the next prompt', () => {
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ printf hello',
      'hello',
      'eletim@E-ryzen:~$ pwd',
      '/home/eletim',
    ]);

    expect(getPromptBlockText(buffer, 0)).toBe('eletim@E-ryzen:~$ printf hello\nhello');
    expect(getPromptBlockText(buffer, 2)).toBe('eletim@E-ryzen:~$ pwd\n/home/eletim');
  });

  it('keeps hash-led comments inside command output', () => {
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ cat config.yml',
      '# generated configuration',
      'enabled: true',
      'eletim@E-ryzen:~$ next-command',
    ]);

    expect(getPromptBlockText(buffer, 0)).toBe(
      'eletim@E-ryzen:~$ cat config.yml\n# generated configuration\nenabled: true',
    );
  });

  it('joins wrapped buffer rows and omits trailing blank rows', () => {
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ printf a-very-long-',
      { text: 'value', wrapped: true },
      'a-very-long-',
      { text: 'value', wrapped: true },
      '',
      '',
    ]);

    expect(findShellPromptRows(buffer)).toEqual([0]);
    expect(getPromptBlockText(buffer, 0)).toBe(
      'eletim@E-ryzen:~$ printf a-very-long-value\na-very-long-value',
    );
  });

  it('rejects a row that is not a prompt boundary', () => {
    expect(getPromptBlockText(createBuffer(['plain output']), 0)).toBeNull();
  });

  it('creates positioned buttons only for prompts in the viewport', () => {
    const gutter = document.createElement('div');
    const onCopy = vi.fn();
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ above',
      'above output',
      'eletim@E-ryzen:~$',
      'visible output',
      'eletim@E-ryzen:~/purplemux$ visible',
      'eletim@E-ryzen:~$ below',
    ]);

    syncPromptCopyButtons({
      gutter,
      buffer,
      viewportY: 2,
      viewportRows: 3,
      screenTop: 4,
      screenHeight: 60,
      label: 'Copy command block',
      onCopy,
    });

    const buttons = [...gutter.querySelectorAll<HTMLButtonElement>('.terminal-prompt-copy-button')];
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.dataset.bufferRow)).toEqual(['2', '4']);
    expect(buttons.map((button) => [button.style.top, button.style.height])).toEqual([
      ['4px', '20px'],
      ['44px', '20px'],
    ]);

    buttons[0].click();
    expect(onCopy).toHaveBeenCalledWith(2);
  });

  it.each(['normal', 'alternate'] as const)(
    'creates a DOM button for a prompt in the %s buffer',
    (type) => {
      const gutter = document.createElement('div');
      const buffer = createBuffer([
        'plain output',
        '  \u200beletim@E-ryzen:~$ printf hello',
        'hello',
      ], type);
      const copied: string[] = [];

      syncPromptCopyButtons({
        gutter,
        buffer,
        viewportY: 0,
        viewportRows: 3,
        screenTop: 0,
        screenHeight: 60,
        label: 'Copy command block',
        onCopy: (row) => {
          const text = getPromptBlockText(buffer, row);
          if (text) copied.push(text);
        },
      });

      const button = gutter.querySelector<HTMLButtonElement>('.terminal-prompt-copy-button');
      expect(button?.dataset.bufferRow).toBe('1');
      const gutterMouseDown = vi.fn();
      gutter.addEventListener('mousedown', gutterMouseDown);
      const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      button?.dispatchEvent(mouseDown);
      expect(mouseDown.defaultPrevented).toBe(true);
      expect(gutterMouseDown).not.toHaveBeenCalled();
      button?.click();
      expect(copied).toEqual(['  \u200beletim@E-ryzen:~$ printf hello\nhello']);
    },
  );

  it('repositions and replaces buttons after scroll, resize, and write', () => {
    const gutter = document.createElement('div');
    const onCopy = vi.fn();
    const rows = [
      'plain output',
      'eletim@E-ryzen:~$ first',
      'plain output',
      'eletim@E-ryzen:~$ second',
      'plain output',
    ];
    const buffer = createBuffer(rows);
    const sync = (viewportY: number, screenTop: number, screenHeight: number) => {
      syncPromptCopyButtons({
        gutter,
        buffer,
        viewportY,
        viewportRows: 3,
        screenTop,
        screenHeight,
        label: 'Copy command block',
        onCopy,
      });
    };

    sync(0, 4, 60);
    expect(gutter.querySelector<HTMLButtonElement>('[data-buffer-row="1"]')?.style.top).toBe('24px');

    sync(2, 4, 60);
    expect(gutter.querySelector('[data-buffer-row="1"]')).toBeNull();
    expect(gutter.querySelector<HTMLButtonElement>('[data-buffer-row="3"]')?.style.top).toBe('24px');

    sync(2, 2, 75);
    const resized = gutter.querySelector<HTMLButtonElement>('[data-buffer-row="3"]');
    expect(resized?.style.top).toBe('27px');
    expect(resized?.style.height).toBe('25px');

    rows[4] = 'eletim@E-ryzen:~$ written';
    sync(2, 2, 75);
    expect(gutter.querySelector('[data-buffer-row="4"]')).not.toBeNull();
  });
});
