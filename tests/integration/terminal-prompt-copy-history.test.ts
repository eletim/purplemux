import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPromptBlockFromSnapshot } from '@/lib/terminal-prompt-copy';
import { capturePaneContentWithHistory } from '@/lib/tmux';

const sessions: string[] = [];
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', 'purple', ...args], { encoding: 'utf8' });

afterEach(() => {
  for (const session of sessions.splice(0)) {
    try { tmux('kill-session', '-t', session); } catch { /* session already exited */ }
  }
});

describe('terminal prompt copy tmux history', () => {
  it('captures off-screen history and joins wrapped rows before finding the next prompt', async () => {
    const session = `pt-issue-59-${process.pid}-${Date.now()}`;
    sessions.push(session);
    const wrapped = `WRAPPED_${'x'.repeat(70)}`;
    const command = [
      "printf 'user@host:~$ first\\n'",
      "seq -f 'OUTPUT_%04g' 1 130",
      `printf '${wrapped}\\n'`,
      "printf 'user@host:~$ second\\nSECOND_OUTPUT\\n'",
      'sleep 30',
    ].join('; ');

    tmux('-f', `${process.cwd()}/src/config/tmux.conf`, 'new-session', '-d', '-s', session,
      '-x', '30', '-y', '8', `sh -c "${command}"`);
    await vi.waitFor(() => {
      expect(tmux('capture-pane', '-p', '-t', session)).toContain('SECOND_OUTPUT');
    }, { timeout: 10_000 });

    const snapshot = await capturePaneContentWithHistory(session, 'all', { joinWrapped: true });
    expect(snapshot).not.toBeNull();
    const copied = getPromptBlockFromSnapshot(
      snapshot!,
      { text: 'user@host:~$ first', occurrenceFromEnd: 1 },
      'user@host:',
    );

    expect(copied).toContain('OUTPUT_0001');
    expect(copied).toContain('OUTPUT_0130');
    expect(copied).toContain(wrapped);
    expect(copied).not.toContain('user@host:~$ second');
    expect(copied).not.toContain('SECOND_OUTPUT');
  });
});
