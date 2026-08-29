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
  return {
    execFile,
    spawn: vi.fn(() => {
      const listeners: Record<string, (value: unknown) => void> = {};
      return {
        stderr: { on: vi.fn() },
        once: vi.fn((event: string, callback: (value: unknown) => void) => {
          listeners[event] = callback;
        }),
        stdin: {
          end: vi.fn(() => listeners.close?.(0)),
        },
      };
    }),
  };
});

vi.mock('child_process', () => ({ execFile: mocks.execFile, spawn: mocks.spawn }));

import { killSession, sendLiteralText } from '@/lib/tmux';

describe('tmux input transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, '', ''));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('passes arbitrary literal text through stdin instead of the process argument list', async () => {
    const text = `- markdown item\0${'x'.repeat(256 * 1024)}`;
    await sendLiteralText('tmux-1', text);

    const child = mocks.spawn.mock.results[0]?.value;
    expect(mocks.spawn).toHaveBeenCalledWith(
      'tmux',
      ['-L', 'purple', 'load-buffer', '-b', expect.stringMatching(/^pmux-input-/), '-'],
      expect.objectContaining({ stdio: ['pipe', 'ignore', 'pipe'] }),
    );
    expect(child.stdin.end).toHaveBeenCalledWith(text);
    expect(mocks.execFile).toHaveBeenLastCalledWith(
      'tmux',
      ['-L', 'purple', 'paste-buffer', '-d', '-r', '-b', expect.stringMatching(/^pmux-input-/), '-t', 'tmux-1'],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it('terminates the pane process group before killing the tmux session', async () => {
    let sessionAlive = true;
    mocks.execFile.mockImplementation((_file, args, _options, callback) => {
      if (args.includes('has-session')) {
        callback(sessionAlive ? null : new Error('missing'), '', '');
      } else if (args.includes('display-message')) {
        callback(null, '4321\n', '');
      } else if (args.includes('kill-session')) {
        sessionAlive = false;
        callback(null, '', '');
      } else {
        callback(null, '', '');
      }
    });
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await killSession('tmux-1');

    expect(processKill).toHaveBeenCalledWith(-4321, 'SIGTERM');
    expect(processKill).not.toHaveBeenCalledWith(-4321, 'SIGKILL');
    expect(mocks.execFile).toHaveBeenCalledWith(
      'tmux',
      ['-L', 'purple', 'kill-session', '-t', 'tmux-1'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('escalates a surviving process group to SIGKILL', async () => {
    vi.useFakeTimers();
    let killAttempts = 0;
    mocks.execFile.mockImplementation((_file, args, _options, callback) => {
      if (args.includes('has-session')) {
        callback(killAttempts >= 2 ? new Error('missing') : null, '', '');
      } else if (args.includes('display-message')) {
        callback(null, '4321\n', '');
      } else if (args.includes('kill-session')) {
        killAttempts += 1;
        callback(null, '', '');
      } else {
        callback(null, '', '');
      }
    });
    const processKill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const close = killSession('tmux-1');
    await vi.runAllTimersAsync();
    await close;

    expect(processKill).toHaveBeenCalledWith(-4321, 'SIGTERM');
    expect(processKill).toHaveBeenCalledWith(-4321, 'SIGKILL');
    expect(killAttempts).toBe(2);
  });
});
