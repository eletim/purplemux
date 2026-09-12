import { describe, expect, it } from 'vitest';
import {
  findLogicalLineStart,
  findShellCommandRange,
  looksLikeShellPrompt,
  serializeTerminalRange,
  type ITerminalTextBuffer,
} from '@/lib/terminal-command-output';

const buffer = (lines: Array<[string, boolean?]>): ITerminalTextBuffer => ({
  length: lines.length,
  getLine: (y) => {
    const line = lines[y];
    return line ? { isWrapped: line[1] ?? false, translateToString: () => line[0] } : undefined;
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

    expect(findShellCommandRange(value, 3)).toEqual({ start: 2, end: 3 });
    expect(findShellCommandRange(value, 1)).toEqual({ start: 0, end: 1 });
    expect(findShellCommandRange(value, 4)).toBeNull();
  });
});
