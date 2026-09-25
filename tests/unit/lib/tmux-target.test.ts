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
    ptySpawn: vi.fn(() => ({ kill: vi.fn() })),
  };
});

vi.mock('child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('child_process')>(),
  execFile: mocks.execFile,
}));
vi.mock('node-pty', () => ({ spawn: mocks.ptySpawn }));

import { attachTmuxPty, execTmux, externalTmuxTarget, managedTmuxTarget } from '@/lib/tmux-target';

describe('tmux target operations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selects the managed backend without exposing socket flags to callers', async () => {
    await execTmux(managedTmuxTarget, ['list-sessions']);
    expect(mocks.execFile).toHaveBeenCalledWith('tmux', ['-L', 'purple', 'list-sessions'],
      expect.any(Object), expect.any(Function));
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

  it('validates external PTY attachment before spawning and subscribes synchronously', async () => {
    const validate = vi.fn().mockResolvedValue(undefined);
    const target = externalTmuxTarget('/known/tmux.sock', validate);
    const onSpawn = vi.fn();

    await attachTmuxPty(target, '$1:@2', { name: 'xterm', cols: 80, rows: 24, cwd: '/' }, { onSpawn });

    expect(validate).toHaveBeenCalledTimes(2);
    expect(mocks.ptySpawn).toHaveBeenCalledWith('tmux', [
      '-N', '-S', '/known/tmux.sock', '-u', '-C', 'attach-session',
      '-f', 'read-only,ignore-size', '-t', '$1:@2',
    ], expect.objectContaining({ name: 'xterm' }));
    expect(onSpawn).toHaveBeenCalledWith(mocks.ptySpawn.mock.results[0]?.value);
  });

  it('does not spawn a PTY when external validation fails', async () => {
    const changed = new Error('socket changed');
    const target = externalTmuxTarget('/known/tmux.sock', vi.fn().mockRejectedValue(changed));

    await expect(attachTmuxPty(target, '$1:@2', { name: 'xterm', cols: 80, rows: 24, cwd: '/' }))
      .rejects.toBe(changed);
    expect(mocks.ptySpawn).not.toHaveBeenCalled();
  });

  it('kills an attached PTY when post-spawn validation fails', async () => {
    const changed = new Error('socket changed');
    const validate = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(changed);
    const target = externalTmuxTarget('/known/tmux.sock', validate);

    await expect(attachTmuxPty(target, '$1:@2', { name: 'xterm', cols: 80, rows: 24, cwd: '/' }))
      .rejects.toBe(changed);
    expect(mocks.ptySpawn.mock.results[0]?.value.kill).toHaveBeenCalledOnce();
  });
});
