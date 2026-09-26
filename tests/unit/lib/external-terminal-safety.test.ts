import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), validate: vi.fn() }));
vi.mock('@/lib/tmux-target', () => ({
  attachTmuxPty: vi.fn(),
  execTmux: mocks.exec,
  validateTmuxTarget: mocks.validate,
}));

import { readExternalHistoryBuffer } from '@/lib/external-terminal-safety';

describe('external terminal safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exec.mockResolvedValue({ stdout: 'old\nhistory\n', stderr: '' });
    mocks.validate.mockResolvedValue(undefined);
  });

  it('captures only bounded pre-display history and revalidates the backend', async () => {
    const backend = { kind: 'external' as const, socketPath: '/known/socket', validate: vi.fn() };
    const signal = new AbortController().signal;

    await expect(readExternalHistoryBuffer(backend, 'purplemux-history-id', signal))
      .resolves.toBe('old\r\nhistory\r\n');

    expect(mocks.exec).toHaveBeenNthCalledWith(1, backend,
      ['show-buffer', '-b', 'purplemux-history-id'],
      { timeout: 5000, maxBuffer: 64 * 1024 * 1024, signal });
    expect(mocks.validate).toHaveBeenCalledWith(backend, signal);
    expect(mocks.exec).toHaveBeenNthCalledWith(2, backend,
      ['delete-buffer', '-b', 'purplemux-history-id'], { timeout: 5000 });
  });
});
