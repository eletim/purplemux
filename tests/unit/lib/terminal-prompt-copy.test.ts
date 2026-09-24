// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  findShellPromptRows,
  getPromptBlockFromSnapshot,
  getPromptBlockText,
  getPromptSnapshotIdentity,
  isShellPrompt,
  syncPromptCopyButtons,
  type ITerminalPromptBuffer,
  type ITerminalPromptLine,
} from '@/lib/terminal-prompt-copy';

const PROMPT_PREFIX = 'eletim@E-ryzen:';

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
  it('matches only the configured prompt prefix at the start of the line', () => {
    expect(isShellPrompt('eletim@E-ryzen:~$', PROMPT_PREFIX)).toBe(true);
    expect(isShellPrompt('eletim@E-ryzen:/srv/app# command', PROMPT_PREFIX)).toBe(true);
    expect(isShellPrompt('root@server:/srv/app#', PROMPT_PREFIX)).toBe(false);
    expect(isShellPrompt('  eletim@E-ryzen:~$ pnpm test', PROMPT_PREFIX)).toBe(true);
    expect(isShellPrompt('\u200beletim@E-ryzen:~$ pnpm test', PROMPT_PREFIX)).toBe(true);
    expect(isShellPrompt('eletim@E-ryzen:~$', '')).toBe(false);
    expect(isShellPrompt('build output: 100% done', PROMPT_PREFIX)).toBe(false);
  });

  it('finds prompt rows from the complete buffer', () => {
    const buffer = createBuffer([
      'old scrollback',
      'eletim@E-ryzen:~$ first',
      'first output',
      'eletim@E-ryzen:~/purplemux$ second',
    ]);

    expect(findShellPromptRows(buffer, PROMPT_PREFIX)).toEqual([1, 3]);
  });

  it('limits prompt detection to the requested tail of the buffer', () => {
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ old',
      'old output',
      'eletim@E-ryzen:~$ recent',
      'recent output',
    ]);

    expect(findShellPromptRows(buffer, PROMPT_PREFIX, 2)).toEqual([2]);
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

    expect(findShellPromptRows(buffer, PROMPT_PREFIX, 4975)).toEqual([4998]);
    expect(reads).toBeLessThan(100);
  });

  it('copies through the row before the next prompt', () => {
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ printf hello',
      'hello',
      'eletim@E-ryzen:~$ pwd',
      '/home/eletim',
    ]);

    expect(getPromptBlockText(buffer, 0, PROMPT_PREFIX)).toBe('eletim@E-ryzen:~$ printf hello\nhello');
    expect(getPromptBlockText(buffer, 2, PROMPT_PREFIX)).toBe('eletim@E-ryzen:~$ pwd\n/home/eletim');
  });

  it('reads forward in chunks and stops at the next prompt', () => {
    const rows = Array.from({ length: 160 }, (_, row) => `output ${row}`);
    rows[5] = 'eletim@E-ryzen:~$ first';
    rows[87] = 'eletim@E-ryzen:~$ second';
    const reads: number[] = [];
    const source = createBuffer(rows);
    const buffer: ITerminalPromptBuffer = {
      length: source.length,
      getLine: (row) => {
        reads.push(row);
        return source.getLine(row);
      },
    };

    expect(getPromptBlockText(buffer, 5, PROMPT_PREFIX)).toBe(rows.slice(5, 87).join('\n'));
    expect(reads.every((row) => row >= 5 && row < 126)).toBe(true);
    expect(reads.length).toBeLessThan(300);
  });

  it('keeps the click-time end when output is appended during a chunk read', () => {
    const rows = Array.from({ length: 45 }, (_, row) => row === 0
      ? 'eletim@E-ryzen:~$ first'
      : `output ${row}`);
    const source = createBuffer(rows);
    const reads: number[] = [];
    let appended = false;
    const buffer: ITerminalPromptBuffer = {
      get length() { return rows.length; },
      getLine: (row) => {
        reads.push(row);
        if (row === 40 && !appended) {
          appended = true;
          rows.push('eletim@E-ryzen:~$ later', 'later output');
        }
        return source.getLine(row);
      },
    };

    expect(getPromptBlockText(buffer, 0, PROMPT_PREFIX)).toBe(rows.slice(0, 45).join('\n'));
    expect(Math.max(...reads)).toBe(44);
  });

  it('joins wrapped lines that cross a chunk boundary', () => {
    const rows: Array<string | { text: string; wrapped: boolean }> = [
      'eletim@E-ryzen:~$ first',
      ...Array.from({ length: 38 }, (_, row) => `output ${row}`),
      'long ',
      { text: 'line', wrapped: true },
      'eletim@E-ryzen:~$ second',
    ];

    expect(getPromptBlockText(createBuffer(rows), 0, PROMPT_PREFIX)).toBe(
      [...rows.slice(0, 39), 'long line'].join('\n'),
    );
  });

  it('keeps hash-led comments inside command output', () => {
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ cat config.yml',
      '# generated configuration',
      'enabled: true',
      'eletim@E-ryzen:~$ next-command',
    ]);

    expect(getPromptBlockText(buffer, 0, PROMPT_PREFIX)).toBe(
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

    expect(findShellPromptRows(buffer, PROMPT_PREFIX)).toEqual([0]);
    expect(getPromptBlockText(buffer, 0, PROMPT_PREFIX)).toBe(
      'eletim@E-ryzen:~$ printf a-very-long-value\na-very-long-value',
    );
  });

  it('rejects a row that is not a prompt boundary', () => {
    expect(getPromptBlockText(createBuffer(['plain output']), 0, PROMPT_PREFIX)).toBeNull();
  });

  it('identifies a clicked prompt with stable surrounding and click-end context', () => {
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ make test',
      'first run',
      'eletim@E-ryzen:~$ make test',
      'second run',
      'eletim@E-ryzen:~$ pwd',
    ]);

    expect(getPromptSnapshotIdentity(buffer, 0, PROMPT_PREFIX)).toMatchObject({
      text: 'eletim@E-ryzen:~$ make test',
      before: [],
      after: ['first run', 'eletim@E-ryzen:~$ make test', 'second run', 'eletim@E-ryzen:~$ pwd'],
      nextPrompt: 'eletim@E-ryzen:~$ make test',
    });
    expect(getPromptSnapshotIdentity(buffer, 2, PROMPT_PREFIX)).toMatchObject({
      text: 'eletim@E-ryzen:~$ make test',
      before: ['eletim@E-ryzen:~$ make test', 'first run'],
      after: ['second run', 'eletim@E-ryzen:~$ pwd'],
      nextPrompt: 'eletim@E-ryzen:~$ pwd',
    });
  });

  it('copies from tmux history even when older content is absent from xterm', () => {
    const historicalOutput = Array.from({ length: 120 }, (_, row) => `historical output ${row}`);
    const xtermBuffer = createBuffer([
      'eletim@E-ryzen:~$ selected',
      ...historicalOutput,
      'wrapped output reconstructed as one logical line',
      'eletim@E-ryzen:~$ next',
      'new block',
    ]);
    const identity = getPromptSnapshotIdentity(xtermBuffer, 0, PROMPT_PREFIX);
    const snapshot = [
      'older prompt and output missing from xterm',
      'eletim@E-ryzen:~$ selected',
      ...historicalOutput,
      'wrapped output reconstructed as one logical line',
      'eletim@E-ryzen:~$ next',
      'new block',
    ].join('\n');

    expect(identity).not.toBeNull();
    expect(getPromptBlockFromSnapshot(snapshot, identity!, PROMPT_PREFIX)).toBe([
      'eletim@E-ryzen:~$ selected',
      ...historicalOutput,
      'wrapped output reconstructed as one logical line',
    ].join('\n'));
  });

  it('uses surrounding context instead of xterm tail position for repeated prompts', () => {
    const xtermAtClick = [
      'unique context for selected prompt',
      'eletim@E-ryzen:~$ repeat',
      'selected output',
      'eletim@E-ryzen:~$ other',
      'other output',
      'unique context for later prompt',
      'eletim@E-ryzen:~$ repeat',
      'latest output',
    ];
    const identity = getPromptSnapshotIdentity(createBuffer(xtermAtClick), 1, PROMPT_PREFIX);

    expect(identity).not.toBeNull();
    expect(getPromptBlockFromSnapshot(xtermAtClick.join('\n'), identity!, PROMPT_PREFIX)).toBe(
      'eletim@E-ryzen:~$ repeat\nselected output',
    );
  });

  it('cuts an open block at the click-time end when the captured snapshot arrives later', () => {
    const clickRows = [
      'eletim@E-ryzen:~$ final',
      'output present at click',
      'partial output',
    ];
    const identity = getPromptSnapshotIdentity(createBuffer(clickRows), 0, PROMPT_PREFIX);
    const delayedSnapshot = [
      ...clickRows.slice(0, -1),
      'partial output added after click',
      'another post-click line',
      'eletim@E-ryzen:~$ prompt after click',
    ].join('\n');

    expect(identity).not.toBeNull();
    expect(getPromptBlockFromSnapshot(delayedSnapshot, identity!, PROMPT_PREFIX)).toBe(
      clickRows.join('\n'),
    );
  });

  it('binds repetitive click-end context to the selected prompt offset', () => {
    const clickRows = [
      'eletim@E-ryzen:~$ repeat-output',
      ...Array.from({ length: 8 }, () => 'same output'),
    ];
    const identity = getPromptSnapshotIdentity(createBuffer(clickRows), 0, PROMPT_PREFIX);
    const backendSnapshot = [
      ...Array.from({ length: 8 }, () => 'same output'),
      ...clickRows,
      'history outside xterm',
      'eletim@E-ryzen:~$ next',
    ].join('\n');

    expect(identity).not.toBeNull();
    expect(getPromptBlockFromSnapshot(backendSnapshot, identity!, PROMPT_PREFIX)).toBe(
      clickRows.join('\n'),
    );
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
      promptPrefix: PROMPT_PREFIX,
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
          const text = getPromptBlockText(buffer, row, PROMPT_PREFIX);
          if (text) copied.push(text);
        },
        promptPrefix: PROMPT_PREFIX,
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
        promptPrefix: PROMPT_PREFIX,
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
