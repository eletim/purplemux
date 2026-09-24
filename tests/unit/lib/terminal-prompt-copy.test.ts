// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  findShellPromptRows,
  getPromptBlockFromSnapshot,
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

  it('continues past the xterm tail through the backend snapshot end', () => {
    const clickRows = [
      'eletim@E-ryzen:~$ final',
      'output present at click',
      'visible viewport end',
    ];
    const identity = getPromptSnapshotIdentity(createBuffer(clickRows), 0, PROMPT_PREFIX);
    const backendSnapshot = [
      ...clickRows,
      'history outside xterm',
      'backend snapshot end',
    ].join('\n');

    expect(identity).not.toBeNull();
    expect(getPromptBlockFromSnapshot(backendSnapshot, identity!, PROMPT_PREFIX)).toBe(
      [...clickRows, 'history outside xterm', 'backend snapshot end'].join('\n'),
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
      [...clickRows, 'history outside xterm'].join('\n'),
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
      const onCopy = vi.fn();

      syncPromptCopyButtons({
        gutter,
        buffer,
        viewportY: 0,
        viewportRows: 3,
        screenTop: 0,
        screenHeight: 60,
        label: 'Copy command block',
        onCopy,
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
      expect(onCopy).toHaveBeenCalledWith(1);
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
