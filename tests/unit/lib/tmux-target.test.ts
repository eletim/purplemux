import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const execFile = vi.fn((_file, _args, _options, callback) => callback(null, 'ok', ''));
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: (file: string, args: string[], options: unknown) => new Promise((resolve, reject) => {
      execFile(file, args, options, (error: Error | null, stdout: string, stderr: string) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    }),
  });
  return {
    execFile,
  };
});

vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  execFile: mocks.execFile,
}));

import { execTmux, externalTmuxTarget, managedTmuxTarget, tmuxAttachArgs, tmuxTargetArgs } from '@/lib/tmux-target';

describe('tmux target operations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selects the managed backend without exposing socket flags to callers', () => {
    expect(tmuxTargetArgs(managedTmuxTarget, ['list-sessions'])).toEqual([
      '-L', 'purple', 'list-sessions',
    ]);
  });

  it('validates an external backend before each command', async () => {
    const validate = vi.fn().mockResolvedValue(undefined);
    const target = externalTmuxTarget('/known/tmux.sock', validate);

    await expect(execTmux(target, ['display-message', '-p'])).resolves.toMatchObject({ stdout: 'ok' });

    expect(validate).toHaveBeenCalledOnce();
    expect(mocks.execFile).toHaveBeenCalledWith(
      'tmux',
      ['-N', '-S', '/known/tmux.sock', 'display-message', '-p'],
      expect.objectContaining({ encoding: 'utf8' }),
      expect.any(Function),
    );
  });

  it('does not invoke tmux when external target validation fails', async () => {
    const changed = new Error('socket changed');
    const target = externalTmuxTarget('/known/tmux.sock', vi.fn().mockRejectedValue(changed));

    await expect(execTmux(target, ['list-panes'])).rejects.toBe(changed);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('uses the same external target selector for PTY attachment', () => {
    const validate = vi.fn().mockResolvedValue(undefined);
    const target = externalTmuxTarget('/known/tmux.sock', validate);

    expect(tmuxAttachArgs(target, '$1:@2')).toEqual([
      '-N', '-S', '/known/tmux.sock', '-u', '-C', 'attach-session',
      '-f', 'read-only,ignore-size', '-t', '$1:@2',
    ]);
  });
});
