// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  collectPromptBlock,
  getNewlyVisiblePromptRows,
  isShellPrompt,
  restorePromptViewport,
  snapshotPromptRows,
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
  const markerActions = () => ({ label: 'Copy command and output', onCopy: vi.fn() });
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
      ...markerActions(),
    });

    const markers = [...gutter.querySelectorAll<HTMLElement>('.terminal-prompt-marker')];
    expect(markers.map((marker) => marker.dataset.bufferRow)).toEqual(['2', '4']);
    expect(markers.map((marker) => [marker.style.top, marker.style.height])).toEqual([
      ['4px', '20px'],
      ['44px', '20px'],
    ]);
    expect(gutter.querySelectorAll('button')).toHaveLength(2);
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
        ...markerActions(),
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
      ...markerActions(),
    });

    sync();
    expect(gutter.querySelector('.terminal-prompt-marker')).not.toBeNull();

    rows.length = 0;
    sync();
    expect(gutter.querySelector('.terminal-prompt-marker')).toBeNull();
  });

  it('copies from the clicked prompt to just before the next visible prompt', async () => {
    const rows = snapshotPromptRows(createBuffer([
      'eletim@E-ryzen:~$ printf hello',
      'hello',
      'eletim@E-ryzen:~$ pwd',
      '/home/eletim',
    ]), 0, 4);
    const loadNextRows = vi.fn();

    await expect(collectPromptBlock({
      initialRows: rows,
      promptPrefix: PROMPT_PREFIX,
      loadNextRows,
    })).resolves.toBe('eletim@E-ryzen:~$ printf hello\nhello');
    expect(loadNextRows).not.toHaveBeenCalled();
  });

  it('loads only each newly visible group of three rows until the next prompt', async () => {
    const loadNextRows = vi.fn()
      .mockResolvedValueOnce(snapshotPromptRows(createBuffer(['three', 'four', 'five']), 0, 3))
      .mockResolvedValueOnce(snapshotPromptRows(createBuffer([
        'six',
        'eletim@E-ryzen:~$ next',
        'next output',
      ]), 0, 3));

    await expect(collectPromptBlock({
      initialRows: snapshotPromptRows(createBuffer([
        'eletim@E-ryzen:~$ first',
        'one',
        'two',
      ]), 0, 3),
      promptPrefix: PROMPT_PREFIX,
      loadNextRows,
    })).resolves.toBe([
      'eletim@E-ryzen:~$ first', 'one', 'two', 'three', 'four', 'five', 'six',
    ].join('\n'));
    expect(loadNextRows).toHaveBeenCalledTimes(2);
  });

  it('copies more than 100 output rows without gaps or duplicates before the next prompt', async () => {
    const outputRows = Array.from({ length: 105 }, (_, index) => `output-${index + 1}`);
    const expected = [
      'eletim@E-ryzen:~$ long-running-command',
      ...outputRows,
    ];
    const remainingRows = [
      ...outputRows.slice(2),
      'eletim@E-ryzen:~$ next-command',
      'next output',
    ];
    const loadedGroups: string[][] = [];
    const loadNextRows = vi.fn(async () => {
      const nextGroup = remainingRows.splice(0, 3);
      loadedGroups.push(nextGroup);
      return snapshotPromptRows(createBuffer(nextGroup), 0, nextGroup.length);
    });

    await expect(collectPromptBlock({
      initialRows: snapshotPromptRows(createBuffer(expected.slice(0, 3)), 0, 3),
      promptPrefix: PROMPT_PREFIX,
      loadNextRows,
    })).resolves.toBe(expected.join('\n'));
    expect(loadNextRows).toHaveBeenCalledTimes(35);
    expect(loadedGroups).toHaveLength(35);
    expect(loadedGroups.every((group) => group.length === 3)).toBe(true);
  });

  it('adds one to three rows after validating the overlap for a full or final scroll', () => {
    const previous = snapshotPromptRows(createBuffer(['one', 'two', 'three', 'four', 'five']), 0, 5);
    const advancedThree = snapshotPromptRows(createBuffer(['four', 'five', 'six', 'seven', 'eight']), 0, 5);
    const advancedTwo = snapshotPromptRows(createBuffer(['three', 'four', 'five', 'six', 'seven']), 0, 5);
    const advancedOne = snapshotPromptRows(createBuffer(['two', 'three', 'four', 'five', 'six']), 0, 5);

    expect(getNewlyVisiblePromptRows(previous, advancedThree).map((row) => row.text.trimEnd()))
      .toEqual(['six', 'seven', 'eight']);
    expect(getNewlyVisiblePromptRows(previous, advancedTwo).map((row) => row.text.trimEnd()))
      .toEqual(['six', 'seven']);
    expect(getNewlyVisiblePromptRows(previous, advancedOne).map((row) => row.text.trimEnd()))
      .toEqual(['six']);
    expect(getNewlyVisiblePromptRows(advancedThree, advancedThree)).toEqual([]);
    expect(getNewlyVisiblePromptRows(previous, snapshotPromptRows(
      createBuffer(['unrelated', 'redraw', 'without', 'validated', 'overlap']), 0, 5,
    ))).toEqual([]);
    const threeRowScreen = snapshotPromptRows(createBuffer(['six', 'seven', 'eight']), 0, 3);
    expect(getNewlyVisiblePromptRows(threeRowScreen, threeRowScreen)).toEqual([]);
  });

  it('does not return a partial block when loading the next rows fails', async () => {
    await expect(collectPromptBlock({
      initialRows: snapshotPromptRows(createBuffer([
        'eletim@E-ryzen:~$ first',
        'partial output',
      ]), 0, 2),
      promptPrefix: PROMPT_PREFIX,
      loadNextRows: vi.fn().mockResolvedValue(null),
    })).resolves.toBeNull();
  });

  it('restores by observed rows when the first upward scroll only re-enters copy-mode', async () => {
    const screens = [
      snapshotPromptRows(createBuffer(['four', 'five', 'six']), 0, 3),
      snapshotPromptRows(createBuffer(['one', 'two', 'three']), 0, 3),
    ];
    const targetRows = screens[1];
    let currentScreen = 0;
    let scrolls = 0;

    await expect(restorePromptViewport({
      targetRows,
      readRows: () => screens[currentScreen],
      scrollUp: async () => {
        scrolls++;
        if (scrolls > 1) currentScreen = 1;
      },
      maxAttempts: 2,
    })).resolves.toBe(true);
    expect(scrolls).toBe(2);
  });

  it('keeps a wrapped logical line intact across three-row loads', async () => {
    const loadNextRows = vi.fn().mockResolvedValueOnce(snapshotPromptRows(createBuffer([
      { text: 'line', wrapped: true },
      'eletim@E-ryzen:~$ next',
      'next output',
    ]), 0, 3));

    await expect(collectPromptBlock({
      initialRows: snapshotPromptRows(createBuffer([
        'eletim@E-ryzen:~$ first',
        'long ',
      ]), 0, 2),
      promptPrefix: PROMPT_PREFIX,
      loadNextRows,
    })).resolves.toBe('eletim@E-ryzen:~$ first\nlong line');
  });

  it('uses marker clicks to select the prompt row', () => {
    const gutter = document.createElement('div');
    const actions = markerActions();
    syncPromptMarkers({
      gutter,
      buffer: createBuffer(['eletim@E-ryzen:~$ command']),
      viewportY: 0,
      viewportRows: 1,
      screenTop: 0,
      screenHeight: 20,
      promptPrefix: PROMPT_PREFIX,
      ...actions,
    });

    const marker = gutter.querySelector<HTMLButtonElement>('.terminal-prompt-marker');
    expect(marker?.getAttribute('aria-label')).toBe(actions.label);
    marker?.click();
    expect(actions.onCopy).toHaveBeenCalledWith(0);
  });
});
