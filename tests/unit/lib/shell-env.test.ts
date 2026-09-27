import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pristine-env', () => ({
  PRISTINE_ENV: {
    HOME: '/test/home',
    PATH: '/test/bin',
    SHELL: '/bin/sh',
    TMUX_TMPDIR: '/test/tmux',
    PURPLEMUX_PRIVATE_VALUE: 'do-not-inherit',
  },
}));

describe('shell environment', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('preserves the tmux socket namespace without leaking unrelated values', async () => {
    const { buildShellEnv } = await import('@/lib/shell-env');

    expect(buildShellEnv()).toMatchObject({
      HOME: '/test/home',
      TMUX_TMPDIR: '/test/tmux',
    });
    expect(buildShellEnv()).not.toHaveProperty('PURPLEMUX_PRIVATE_VALUE');
  });
});
