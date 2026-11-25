import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { findCodexSessionById, findLatestCodexSessionForCwd } from '@/lib/providers/codex/session-detection';
import { codexHookIdentityRejection, processCodexHookPayload } from '@/lib/providers/codex/hook-handler';
import { isCodexSubagent } from '@/lib/providers/codex/session-origin';

const manager = vi.hoisted(() => ({ applyAgentHookMeta: vi.fn(() => ({ cliState: 'idle' })), handleProviderEvent: vi.fn() }));
vi.mock('@/lib/status-manager', () => ({ getStatusManager: () => manager }));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: () => true }));
vi.mock('@/lib/access-filter', () => ({ isRequestAllowed: () => true }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import handler from '@/pages/api/status/hook';
import { codexHookEvents } from '@/lib/providers/codex/hook-events';
import type { NextApiRequest, NextApiResponse } from 'next';

async function fixture() {
  const sessionsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-child-'));
  const dir = path.join(sessionsRoot, '2026', '11', '25'); await fs.mkdir(dir, { recursive: true });
  const write = async (id: string, extra: object, minutes: number) => {
    const file = path.join(dir, `rollout-${id}.jsonl`);
    await fs.writeFile(file, JSON.stringify({ type: 'session_meta', payload: { id, cwd: '/same/cwd', timestamp: '2026-11-25T00:00:00Z', ...extra } }) + '\n');
    const time = new Date(`2026-11-25T00:${String(minutes).padStart(2, '0')}:00Z`); await fs.utimes(file, time, time); return file;
  };
  return { sessionsRoot, write, options: { sessionsRoot, daysBack: 1, now: new Date('2026-11-25T12:00:00Z') } };
}

describe('Codex child session identity', () => {
  it('ignores newer children for implicit cwd discovery while keeping ordinary CLI fork and explicit resume lookup', async () => {
    const f = await fixture();
    try {
      const root = await f.write('parent', { source: 'cli', agent_path: '/root', forked_from_id: 'previous-root' }, 1);
      await f.write('child', { source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } }, agent_path: '/root/worker' }, 5);
      await f.write('nested-child', { agent_path: '/root/worker/nested' }, 6);
      expect((await findLatestCodexSessionForCwd('/same/cwd', f.options))?.jsonlPath).toBe(root);
      expect((await findCodexSessionById('parent', f.options))?.jsonlPath).toBe(root);
      // An explicit ID lookup remains exact (used by deliberate resume); it is not cwd inference.
      expect((await findCodexSessionById('child', f.options))?.isSubagent).toBe(true);
    } finally { await fs.rm(f.sessionsRoot, { recursive: true, force: true }); }
  });

  it('does not equate fork ancestry alone with a subagent and rejects positive native child markers', () => {
    expect(isCodexSubagent({ source: 'cli', agent_path: '/root' })).toBe(false);
    expect(isCodexSubagent({ source: 'resume' })).toBe(false);
    expect(isCodexSubagent({ source: { subagent: 'review' } })).toBe(true);
    expect(isCodexSubagent({ thread_source: 'subagent' })).toBe(true);
    expect(processCodexHookPayload({ hook_event_name: 'Stop', session_id: 'child', agent_path: '/root/child' }).translation).toEqual({});
  });

  it('native header guard rejects all child hook kinds and mismatched transcripts, including inherited startup source', async () => {
    const f = await fixture();
    try {
      const file = await f.write('child', { source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }, 1);
      for (const hook_event_name of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest']) {
        expect(await codexHookIdentityRejection({ hook_event_name, source: 'startup', session_id: 'child', transcript_path: file })).toBe('subagent');
      }
      expect(await codexHookIdentityRejection({ session_id: 'unwritten', transcript_path: path.join(f.sessionsRoot, 'not-yet-written.jsonl') })).toBe('session-origin-unavailable');
      expect(await codexHookIdentityRejection({})).toBe('missing-session-id');
      expect(await codexHookIdentityRejection({ session_id: 'parent', transcript_path: file })).toBe('session-mismatch');
      const root = await f.write('parent', { source: 'cli', forked_from_id: 'old-root' }, 2);
      for (const source of ['startup', 'resume', 'clear']) expect(await codexHookIdentityRejection({ source, session_id: 'parent', transcript_path: root })).toBeNull();
    } finally { await fs.rm(f.sessionsRoot, { recursive: true, force: true }); }
  });

  it('HTTP hook rejects child metadata before tab mutation, session broadcast or work-state event', async () => {
    const f = await fixture(); const emitted = vi.spyOn(codexHookEvents, 'emit');
    try {
      const file = await f.write('child', { source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }, 1);
      const res = { status: vi.fn().mockReturnThis(), end: vi.fn(), json: vi.fn() };
      for (const hook_event_name of ['SessionStart', 'Stop', 'PermissionRequest']) {
        await handler({ method: 'POST', query: { provider: 'codex', tmuxSession: 'parent-tab' }, socket: {}, body: { hook_event_name, session_id: 'child', transcript_path: file } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
      }
      expect(res.status).toHaveBeenCalledWith(204);
      expect(manager.applyAgentHookMeta).not.toHaveBeenCalled(); expect(manager.handleProviderEvent).not.toHaveBeenCalled(); expect(emitted).not.toHaveBeenCalled();
      const root = await f.write('parent', { source: 'cli', agent_path: '/root', forked_from_id: 'old' }, 2);
      await handler({ method: 'POST', query: { provider: 'codex', tmuxSession: 'parent-tab' }, socket: {}, body: { hook_event_name: 'SessionStart', source: 'resume', session_id: 'parent', transcript_path: root } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
      expect(manager.applyAgentHookMeta).toHaveBeenCalledWith('codex', 'parent-tab', expect.objectContaining({ sessionId: 'parent' }));
      expect(emitted).toHaveBeenCalledWith('session-info', 'parent-tab', expect.objectContaining({ sessionId: 'parent' }));
    } finally { emitted.mockRestore(); await fs.rm(f.sessionsRoot, { recursive: true, force: true }); }
  });
});
