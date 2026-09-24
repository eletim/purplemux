// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  findNewPromptRows,
  findShellPromptRows,
  getPromptBlockText,
  getPromptBlockTextWithScroll,
  isShellPrompt,
  loadNewPromptRowsAfterScroll,
  snapshotPromptRows,
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

  it.each([18, 64, 148])(
    'loads more rows until it finds a prompt %i rows after the clicked prompt',
    async (distance) => {
      const allRows = [
        'old scrollback',
        'eletim@E-ryzen:~$ first',
        ...Array.from({ length: distance - 1 }, (_, row) => `output ${row}`),
        'eletim@E-ryzen:~$ second',
        'second output',
      ];
      const initiallyLoaded = Math.min(24, allRows.length);
      const buffer = createBuffer(allRows.slice(0, initiallyLoaded));
      let loaded = initiallyLoaded;
      const loadMore = vi.fn(async () => {
        if (loaded >= allRows.length) return null;
        const next = allRows.slice(loaded, loaded + 20);
        loaded += next.length;
        return snapshotPromptRows(createBuffer(next));
      });
      const restore = vi.fn(async () => {});

      await expect(getPromptBlockTextWithScroll(buffer, 1, PROMPT_PREFIX, {
        loadMore,
        restore,
      })).resolves.toBe(allRows.slice(1, 1 + distance).join('\n'));
      expect(loadMore).toHaveBeenCalledTimes(Math.max(0, Math.ceil((distance + 2 - initiallyLoaded) / 20)));
      expect(restore).toHaveBeenCalledOnce();
    },
  );

  it('returns the click-time tail when no later prompt exists', async () => {
    const allRows = [
      'old scrollback',
      'eletim@E-ryzen:~$ first',
      ...Array.from({ length: 125 }, (_, row) => `output ${row}`),
    ];
    const buffer = createBuffer(allRows.slice(0, 24));
    let loaded = 24;

    await expect(getPromptBlockTextWithScroll(buffer, 1, PROMPT_PREFIX, {
      loadMore: async () => {
        if (loaded >= allRows.length) return null;
        const next = allRows.slice(loaded, loaded + 20);
        loaded += next.length;
        return snapshotPromptRows(createBuffer(next));
      },
      restore: async () => {},
    })).resolves.toBe(allRows.slice(1).join('\n'));
  });

  it('joins a wrapped line split across separately loaded ranges', async () => {
    const buffer = createBuffer([
      'eletim@E-ryzen:~$ first',
      'long ',
    ]);
    const loadMore = vi.fn()
      .mockResolvedValueOnce(snapshotPromptRows(createBuffer([
        { text: 'line', wrapped: true },
        'eletim@E-ryzen:~$ second',
      ])));

    await expect(getPromptBlockTextWithScroll(buffer, 0, PROMPT_PREFIX, {
      loadMore,
      restore: async () => {},
    })).resolves.toBe('eletim@E-ryzen:~$ first\nlong line');
  });

  it('extracts only rows newly revealed below an overlapping screen', () => {
    const previous = snapshotPromptRows(createBuffer(['one', 'two', 'three', 'four']));
    const current = snapshotPromptRows(createBuffer(['three', 'four', 'five', 'six']));
    const redrawn = snapshotPromptRows(createBuffer(['three', 'four', 'five', 'six']));
    expect(findNewPromptRows(previous, current).map((row) => row.text)).toEqual(['five', 'six']);
    expect(findNewPromptRows(current, redrawn)).toEqual([]);
  });

  it('waits for a delayed screen redraw and keeps loading until the next prompt', async () => {
    const allRows = [
      'eletim@E-ryzen:~$ first',
      ...Array.from({ length: 7 }, (_, row) => `output ${row}`),
      'eletim@E-ryzen:~$ second',
      'second output',
    ];
    const screenSize = 4;
    let screenStart = 0;
    let pendingScreenStart: number | null = null;
    let retryCount = 0;
    const screenStartsAtRead: number[] = [];
    const readScreen = () => {
      screenStartsAtRead.push(screenStart);
      return snapshotPromptRows(
        createBuffer(allRows.slice(screenStart, screenStart + screenSize)),
      );
    };

    const loadMore = vi.fn(async () => {
      return loadNewPromptRowsAfterScroll({
        readRows: readScreen,
        scroll: async () => {
          pendingScreenStart = Math.min(screenStart + 2, allRows.length - screenSize);
        },
        waitForRetry: async () => {
          retryCount++;
          if (pendingScreenStart !== null) {
            screenStart = pendingScreenStart;
            pendingScreenStart = null;
          }
        },
        retries: 2,
      });
    });

    await expect(getPromptBlockTextWithScroll(
      createBuffer(allRows.slice(0, screenSize)),
      0,
      PROMPT_PREFIX,
      { loadMore, restore: async () => {} },
    )).resolves.toBe(allRows.slice(0, 8).join('\n'));

    expect(loadMore).toHaveBeenCalledTimes(3);
    expect(retryCount).toBe(3);
    expect(screenStartsAtRead.slice(0, 3)).toEqual([0, 0, 2]);
    expect(readScreen().map((row) => row.text)).toEqual(allRows.slice(6, 10));
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

  it('copies 150 offscreen output rows and can show success from a visible button', async () => {
    const gutter = document.createElement('div');
    const allRows = [
      'old scrollback',
      'eletim@E-ryzen:~$ long-command',
      ...Array.from({ length: 150 }, (_, row) => `long output ${row}`),
      'eletim@E-ryzen:~$ next-command',
      'next output',
    ];
    const viewportRows = 24;
    const buffer = createBuffer(allRows.slice(0, viewportRows));
    let loaded = viewportRows;
    const clipboard = vi.fn(async (_text: string) => true);
    const successToast = vi.fn((_message: string) => {});
    let copyFinished: Promise<void> | undefined;

    syncPromptCopyButtons({
      gutter,
      buffer,
      viewportY: 0,
      viewportRows,
      screenTop: 0,
      screenHeight: 480,
      label: 'Copy command block',
      promptPrefix: PROMPT_PREFIX,
      onCopy: (row) => {
        copyFinished = getPromptBlockTextWithScroll(buffer, row, PROMPT_PREFIX, {
          loadMore: async () => {
            if (loaded >= allRows.length) return null;
            const next = allRows.slice(loaded, loaded + 20);
            loaded += next.length;
            return snapshotPromptRows(createBuffer(next));
          },
          restore: async () => {},
        }).then(async (text) => {
          expect(text).not.toBeNull();
          if (text && await clipboard(text)) successToast('Copied');
        });
      },
    });

    const button = gutter.querySelector<HTMLButtonElement>('[data-buffer-row="1"]');
    expect(button).not.toBeNull();
    button?.click();
    await copyFinished;

    expect(clipboard).toHaveBeenCalledWith(allRows.slice(1, 152).join('\n'));
    expect(successToast).toHaveBeenCalledWith('Copied');
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
