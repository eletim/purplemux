import { describe, expect, it } from 'vitest';
import {
  findLogicalLineStart,
  findPrimaryPromptBeforeCursor,
  findShellCommandRange,
  looksLikeShellPrompt,
  serializeTerminalRange,
  serializeTerminalSpan,
  type ITerminalTextBuffer,
} from '@/lib/terminal-command-output';

const buffer = (lines: Array<[string, boolean?]>): ITerminalTextBuffer => ({
  length: lines.length,
  getLine: (y) => {
    const line = lines[y];
    return line ? {
      isWrapped: line[1] ?? false,
      length: line[0].length,
      translateToString: (_trimRight, start = 0, end) => line[0].slice(start, end),
    } : undefined;
  },
});

describe('terminal command output', () => {
  it('keeps the runtime prompt and joins wrapped command lines', () => {
    const value = buffer([
      ['eletim@host:~/repo$ pnpm test --filter ', false],
      ['terminal', true],
      ['PASS terminal', false],
      ['', false],
    ]);

    expect(findLogicalLineStart(value, 1)).toBe(0);
    expect(serializeTerminalRange(value, 0, 3)).toBe(
      'eletim@host:~/repo$ pnpm test --filter terminal\nPASS terminal',
    );
  });

  it('recognizes common bash, zsh, and fish-style prompts', () => {
    expect(looksLikeShellPrompt('eletim@host:~/repo$ ')).toBe(true);
    expect(looksLikeShellPrompt('host% ')).toBe(true);
    expect(looksLikeShellPrompt('~/repo > ')).toBe(true);
    expect(looksLikeShellPrompt('command output')).toBe(false);
  });

  it('finds a command around clicked output in restored scrollback', () => {
    const value = buffer([
      ['user@host:~/one$ echo first'],
      ['first'],
      ['user@host:~/two$ printf second'],
      ['second'],
      ['user@host:~/two$ '],
    ]);

    expect(findShellCommandRange(value, 3)).toEqual({
      start: { line: 2, column: 0 },
      end: { line: 4, column: 0 },
    });
    expect(findShellCommandRange(value, 1)).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 2, column: 0 },
    });
    expect(findShellCommandRange(value, 4)).toBeNull();
  });

  it('keeps output that shares a physical line with the next prompt', () => {
    const value = buffer([
      ['user@host:~/repo$ printf foo'],
      ['foouser@host:~/repo$ '],
    ]);
    const range = findShellCommandRange(value, 1);

    expect(range).toEqual({
      start: { line: 0, column: 0 },
      end: { line: 1, column: 3 },
    });
    expect(range && serializeTerminalSpan(value, range)).toBe(
      'user@host:~/repo$ printf foo\nfoo',
    );
  });

  it('keeps no-newline output when the next prompt has a different path', () => {
    const value = buffer([
      ['user@host:~/one$ cd ../two'],
      ['foouser@host:~/two$ '],
    ]);
    const range = findShellCommandRange(value, 1, 1);

    expect(range && serializeTerminalSpan(value, range)).toBe(
      'user@host:~/one$ cd ../two\nfoo',
    );
  });

  it('includes the path-bearing line of a multiline prompt', () => {
    const value = buffer([
      ['user@host:~/repo'],
      ['$ echo hello'],
      ['hello'],
      ['user@host:~/repo'],
      ['$ '],
    ]);

    expect(findPrimaryPromptBeforeCursor(value, 4, 2)).toMatchObject({
      start: { line: 3, column: 0 },
      end: { line: 4, column: 2 },
    });
    const range = findShellCommandRange(value, 2);
    expect(range && serializeTerminalSpan(value, range)).toBe(
      'user@host:~/repo\n$ echo hello\nhello',
    );
  });

  it('does not treat prompt-like ordinary output as a boundary', () => {
    const value = buffer([
      ['user@host:~/repo$ compare'],
      ['old > new'],
      ['cost $ 5'],
      ['done'],
      ['user@host:~/repo$ '],
    ]);
    const range = findShellCommandRange(value, 3);

    expect(range && serializeTerminalSpan(value, range)).toBe(
      'user@host:~/repo$ compare\nold > new\ncost $ 5\ndone',
    );
  });

  it('keeps path output before a plain Bash prompt', () => {
    const value = buffer([
      ['$ pwd'],
      ['/home/user/repo'],
      ['$ '],
    ]);
    const range = findShellCommandRange(value, 1);

    expect(range && serializeTerminalSpan(value, range)).toBe(
      '$ pwd\n/home/user/repo',
    );
  });

  it('reconstructs wrapped initial and subsequent prompts', () => {
    const value = buffer([
      ['user@host:~/very/long/'],
      ['repo$ echo hello', true],
      ['hello'],
      ['user@host:~/very/long/'],
      ['repo$ ', true],
    ]);

    expect(findPrimaryPromptBeforeCursor(value, 4, 6, {
      tail: 'user@host:~/very/long/repo$ ',
      multilinePrefix: null,
    })).toMatchObject({ start: { line: 3, column: 0 } });
    const range = findShellCommandRange(value, 2);
    expect(range && serializeTerminalSpan(value, range)).toBe(
      'user@host:~/very/long/repo$ echo hello\nhello',
    );
  });

  it('converts Unicode string offsets to terminal cell columns', () => {
    const prompt = 'user@host:~/repo$ ';
    const cellLine = (cells: Array<[string, number]>, isWrapped = false) => ({
      isWrapped,
      length: cells.length,
      getCell: (column: number) => cells[column]
        ? { getChars: () => cells[column][0], getWidth: () => cells[column][1] }
        : undefined,
      translateToString: (_trimRight = false, start = 0, end = cells.length) => cells
        .slice(start, end)
        .map(([chars]) => chars)
        .join(''),
    });
    const asciiCells = (text: string): Array<[string, number]> => [...text].map((char) => [char, 1]);
    const first = cellLine(asciiCells(`${prompt}printf value`));
    const second = cellLine([
      ['界', 2],
      ['', 0],
      ['é', 1],
      ...asciiCells(prompt),
    ]);
    const value: ITerminalTextBuffer = {
      length: 2,
      getLine: (line) => [first, second][line],
    };
    const range = findShellCommandRange(value, 1, 1);

    expect(range).toMatchObject({ end: { line: 1, column: 3 } });
    expect(range && serializeTerminalSpan(value, range)).toBe(
      `${prompt}printf value\n界é`,
    );
  });
});
