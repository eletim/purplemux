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
});
