import fs from 'fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildCodexHookFlags: vi.fn(),
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
  writeClaudePromptFile: vi.fn(),
}));
vi.mock('@/lib/providers/codex/hook-config', () => ({
  buildCodexHookFlags: mocks.buildCodexHookFlags,
}));
vi.mock('@/lib/providers/codex/prompt', () => ({
  getCodexPromptPath: (workspaceId: string) => `/prompts/${workspaceId}.md`,
  toTomlBasicString: (value: string) => JSON.stringify(value),
  writeCodexPromptFile: vi.fn(),
}));

import { claudeProvider } from '@/lib/providers/claude';
import { buildCodexRuntimeArgs, codexProvider } from '@/lib/providers/codex';

const SESSION_ID = '12345678-aaaa-bbbb-cccc-1234567890ab';
const UPDATE_CONFIG = 'check_for_update_on_startup=false';

describe('managed provider update settings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.getDangerouslySkipPermissions.mockResolvedValue(true);
    mocks.buildCodexHookFlags.mockResolvedValue({
      args: ['-c', 'hooks.SessionStart=[{hooks=[]}]'],
      parseError: false,
      userEntryCount: 0,
    });
  });

  it.each([
    ['new', undefined, []],
    ['resumed', SESSION_ID, ['resume', SESSION_ID]],
  ] as const)('adds the Codex update override exactly once for a %s launch', async (_kind, resumeId, prefix) => {
    vi.spyOn(fs, 'readFile').mockResolvedValue('developer prompt');

    const args = await buildCodexRuntimeArgs("workspace's id", resumeId);

    expect(args).toEqual([
      ...prefix,
      '-c',
      UPDATE_CONFIG,
      '-c',
      'hooks.SessionStart=[{hooks=[]}]',
      '-c',
      'developer_instructions="developer prompt"',
      '--yolo',
    ]);
    expect(args.filter((arg) => arg === UPDATE_CONFIG)).toHaveLength(1);
  });

  it('preserves Codex launcher shell quoting for new and resumed launches', async () => {
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('missing'));
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await expect(codexProvider.buildLaunchCommand({ workspaceId: "workspace's id" })).resolves.toMatch(
      /^node '[^']*codex-launcher\.js' --workspace-id 'workspace'\\''s id'$/,
    );
    await expect(codexProvider.buildResumeCommand(SESSION_ID, { workspaceId: "workspace's id" })).resolves.toMatch(
      new RegExp(`^node '[^']*codex-launcher\\.js' --workspace-id 'workspace'\\\\''s id' --resume-session-id '${SESSION_ID}'$`),
    );
  });

  it('sets the Claude updater environment at the provider boundary for new launches', async () => {
    const command = await claudeProvider.buildLaunchCommand({ workspaceId: 'ws-1' });

    expect(command).toBe(
      "DISABLE_AUTOUPDATER=1 claude --settings '/home/Foo Bar/.purplemux/hook'\\''s.json' "
      + "--append-system-prompt-file '/home/Foo Bar/.purplemux/ws-1/prompt'\\''s.md' "
      + '--dangerously-skip-permissions',
    );
    expect(command.match(/DISABLE_AUTOUPDATER=1/g)).toHaveLength(1);
  });

  it('sets the Claude updater environment at the provider boundary for resumed launches', async () => {
    const command = await claudeProvider.buildResumeCommand(SESSION_ID, { workspaceId: 'ws-1' });

    expect(command).toBe(
      `DISABLE_AUTOUPDATER=1 claude --resume ${SESSION_ID} `
      + "--settings '/home/Foo Bar/.purplemux/hook'\\''s.json' "
      + "--append-system-prompt-file '/home/Foo Bar/.purplemux/ws-1/prompt'\\''s.md' "
      + '--dangerously-skip-permissions',
    );
    expect(command.match(/DISABLE_AUTOUPDATER=1/g)).toHaveLength(1);
  });
});
