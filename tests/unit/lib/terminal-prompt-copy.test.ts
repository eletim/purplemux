import { describe, expect, it } from 'vitest';
import {
  findShellPromptRows,
  getPromptBlockText,
  isShellPrompt,
  type ITerminalPromptLine,
} from '@/lib/terminal-prompt-copy';

const createBuffer = (rows: Array<string | { text: string; wrapped: boolean }>) => ({
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
    expect(isShellPrompt('eletim@E-ryzen:~$ pnpm test')).toBe(true);
    expect(isShellPrompt('root@server:/srv/app#')).toBe(true);
    expect(isShellPrompt('~/purplemux % git status')).toBe(true);
    expect(isShellPrompt('$ echo hello')).toBe(true);
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
});
