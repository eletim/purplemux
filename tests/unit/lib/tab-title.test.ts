import { describe, expect, it } from 'vitest';
import { formatTabTitle, parseCurrentWorkingDirectory } from '@/lib/tab-title';

describe('formatTabTitle', () => {
  it('keeps shell panes named by cwd basename', () => {
    expect(formatTabTitle('zsh|/Users/me/project')).toBe('project');
  });

  it('shows Codex for codex tabs backed by node', () => {
    expect(formatTabTitle('node|/Users/me/project', 'codex-cli')).toBe('Codex');
  });

  it('shows Codex for codex tabs backed by the codex executable', () => {
    expect(formatTabTitle('codex|/Users/me/project', 'codex-cli')).toBe('Codex');
  });

  it('does not rename node outside codex tabs', () => {
    expect(formatTabTitle('node|/Users/me/project', 'terminal')).toBe('node');
  });
});

describe('parseCurrentWorkingDirectory', () => {
  it('extracts the full tmux pane path', () => {
    expect(parseCurrentWorkingDirectory('bash|/home/user/a|b')).toBe('/home/user/a|b');
    expect(parseCurrentWorkingDirectory('bash')).toBeNull();
  });
});
