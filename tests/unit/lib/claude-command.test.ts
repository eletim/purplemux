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
it('uses dedicated settings and quoted launch-only model/effort/session while preserving flags',async()=>{
 mocks.getDangerouslySkipPermissions.mockResolvedValue(true);
 const flags=await buildClaudeFlags('ws-1',{settingsPath:"/tmp/new tab/settings.json",sessionId:'11111111-1111-4111-8111-111111111111',model:'claude-opus-5',effort:'high'});
 expect(flags).toContain("--model 'claude-opus-5' --effort 'high'");expect(flags).toContain("--settings '/tmp/new tab/settings.json'");expect(flags).toContain('--dangerously-skip-permissions');expect(flags).toContain('--append-system-prompt-file');
});
