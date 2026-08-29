import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDangerouslySkipPermissions: vi.fn(),
}));

vi.mock('@/lib/config-store', () => ({
  getDangerouslySkipPermissions: mocks.getDangerouslySkipPermissions,
}));
vi.mock('@/lib/hook-settings', () => ({
  HOOK_SETTINGS_PATH: "/home/Foo Bar/.purplemux/hook's.json",
}));
vi.mock('@/lib/claude-prompt', () => ({
  getClaudePromptPath: (workspaceId: string) => `/home/Foo Bar/.purplemux/${workspaceId}/prompt's.md`,
}));

import { buildClaudeFlags } from '@/lib/claude-command';

describe('buildClaudeFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDangerouslySkipPermissions.mockResolvedValue(false);
  });

  it('shell-quotes absolute settings and prompt paths', async () => {
    await expect(buildClaudeFlags('ws-1')).resolves.toBe(
      "--settings '/home/Foo Bar/.purplemux/hook'\\''s.json' "
      + "--append-system-prompt-file '/home/Foo Bar/.purplemux/ws-1/prompt'\\''s.md'",
    );
  });
});
