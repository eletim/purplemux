import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn((_file, _args, _options, callback) => callback(null, '', '')),
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
}));

vi.mock('child_process', () => ({ execFile: mocks.execFile, spawn: mocks.spawn }));

import { sendLiteralText } from '@/lib/tmux';

describe('tmux input transport', () => {
  beforeEach(() => vi.clearAllMocks());

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
});
