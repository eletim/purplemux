import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const execFile = vi.fn((_file, _args, _options, callback) => callback(null, '', ''));
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: (file: string, args: string[], options: unknown) => new Promise((resolve, reject) => {
      execFile(file, args, options, (error: Error | null, stdout: string, stderr: string) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    }),
  });
  return { execFile };
});

vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  execFile: mocks.execFile,
}));

import { killSession } from '@/lib/tmux';

describe('killSession failure semantics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('throws when tmux and the pane process group survive all cleanup attempts', async () => {
    mocks.execFile.mockImplementation((_file, args, _options, callback) => {
      if (args.includes('display-message')) callback(null, '4321\n', '');
      else callback(null, '', '');
    });
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    const cleanup = killSession('tmux-1');
    const rejection = expect(cleanup).rejects.toThrow(
      'Failed to terminate tmux session and process group: tmux-1',
    );
    await vi.runAllTimersAsync();
    await rejection;
  });

  it('propagates a has-session transport failure instead of treating it as absence', async () => {
    const timeout = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
    mocks.execFile.mockImplementation((_file, args, _options, callback) => {
      callback(args.includes('has-session') ? timeout : null, '', '');
    });

    await expect(killSession('tmux-1')).rejects.toBe(timeout);
  });
});
