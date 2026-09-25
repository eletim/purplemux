import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), execBuffer: vi.fn(), identity: vi.fn() }));
vi.mock('@/lib/tmux-target', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tmux-target')>(),
  execTmux: mocks.exec,
  execTmuxBuffer: mocks.execBuffer,
}));
vi.mock('@/lib/external-tmux-socket', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/external-tmux-socket')>(),
  frozenExternalTmuxSocketIdentity: mocks.identity,
}));

import { createExternalTerminal, discoverExternalServer } from '@/lib/external-server-tmux';

describe('external tmux runtime decoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue('1:2:3');
    mocks.exec.mockResolvedValue({ stdout: '$0\t1750000000\t0\t@0\t0\t1\t%0\t0\t1\t123\t0\n', stderr: '' });
    mocks.execBuffer.mockImplementation(async (_target, args: string[]) => {
      const field = args.at(-1) ?? '';
      if (field === '#{pane_current_path}') {
        return { stdout: Buffer.from([0x2f, 0x74, 0x6d, 0x70, 0x2f, 0xff, 0x0a]), stderr: Buffer.alloc(0) };
      }
      const values: Record<string, string> = {
        '#{session_name}': 'external', '#{window_name}': 'shell', '#{pane_current_command}': 'bash',
      };
      return { stdout: Buffer.from(`${values[field] ?? ''}\n`), stderr: Buffer.alloc(0) };
    });
  });

  it('creates a new session and returns stable identities for ownership persistence', async () => {
    mocks.exec.mockResolvedValue({ stdout: '$4\t1750000001\t@7\n', stderr: '' });
    const created = await createExternalTerminal({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
    }, { name: 'my terminal' });

    expect(created).toEqual({ serverId: 'server', sessionId: '$4', sessionCreated: '1750000001',
      windowId: '@7', name: 'my terminal' });
    expect(mocks.exec).toHaveBeenCalledWith(expect.anything(), [
      'new-session', '-d', '-P', '-F', '#{session_id}\t#{session_created}\t#{window_id}',
      '-s', 'my terminal',
    ], expect.objectContaining({ timeout: 5000 }));
  });

  it('marks only an exact persisted session identity as owned', async () => {
    const provenance = { id: 'terminal-1', owner: 'purplemux' as const, resourceType: 'session' as const,
      sessionId: '$0', sessionCreated: '1750000000', createdAt: '2026-09-26T00:00:00.000Z' };
    const inventory = await discoverExternalServer({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
      ownedTerminals: [provenance],
    });
    expect(inventory.sessions[0]).toMatchObject({ owned: true, provenance });

    mocks.exec.mockResolvedValue({ stdout: '$0\t1750000002\t0\t@0\t0\t1\t%0\t0\t1\t123\t0\n', stderr: '' });
    const replacement = await discoverExternalServer({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
      ownedTerminals: [provenance],
    });
    expect(replacement.sessions[0]).toMatchObject({ owned: false });
    expect(replacement.sessions[0]).not.toHaveProperty('provenance');
  });

  it('uses tmux 2.9-compatible enumeration and confines invalid UTF-8 to its field', async () => {
    const inventory = await discoverExternalServer({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
    });

    expect(mocks.exec.mock.calls[0][1].join(' ')).not.toContain('#{n:');
    expect(inventory).toMatchObject({ exists: true, sessions: [{ name: 'external', windows: [{
      name: 'shell', panes: [{ currentCommand: 'bash', currentPath: '/tmp/�' }],
    }] }] });
  });

  it('retries a live snapshot when a resource disappears during metadata lookup', async () => {
    const stale = '$0\t1750000000\t0\t@0\t0\t1\t%0\t0\t0\t123\t0\n'
      + '$0\t1750000000\t0\t@0\t0\t1\t%1\t1\t1\t124\t0\n';
    const survivor = '$0\t1750000000\t0\t@0\t0\t1\t%1\t0\t1\t124\t0\n';
    mocks.exec.mockReset()
      .mockResolvedValueOnce({ stdout: stale, stderr: '' })
      .mockResolvedValueOnce({ stdout: '456\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: survivor, stderr: '' });
    mocks.execBuffer.mockImplementation(async (_target, args: string[]) => {
      if (args[3] === '%0') throw new Error('can\'t find pane: %0');
      const field = args.at(-1);
      const value = field === '#{session_name}' ? 'external' : field === '#{window_name}' ? 'shell'
        : field === '#{pane_current_path}' ? '/tmp' : 'bash';
      return { stdout: Buffer.from(`${value}\n`), stderr: Buffer.alloc(0) };
    });

    const inventory = await discoverExternalServer({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
    });

    expect(inventory).toMatchObject({ exists: true, sessions: [{ windows: [{ panes: [{ id: '%1' }] }] }] });
    expect(inventory.sessions[0].windows[0].panes).toHaveLength(1);
    expect(mocks.exec).toHaveBeenCalledTimes(3);
  });

  it('bounds concurrent metadata commands for large inventories', async () => {
    mocks.exec.mockResolvedValue({ stdout: Array.from({ length: 20 }, (_, pane) =>
      `$0\t1750000000\t0\t@0\t0\t1\t%${pane}\t${pane}\t${pane === 0 ? 1 : 0}\t${100 + pane}\t0`).join('\n') + '\n', stderr: '' });
    let active = 0;
    let maximum = 0;
    mocks.execBuffer.mockImplementation(async (_target, args: string[]) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      const field = args.at(-1);
      const value = field === '#{session_name}' ? 'external' : field === '#{window_name}' ? 'shell'
        : field === '#{pane_current_path}' ? '/tmp' : 'bash';
      return { stdout: Buffer.from(`${value}\n`), stderr: Buffer.alloc(0) };
    });

    const inventory = await discoverExternalServer({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
    });

    expect(inventory.sessions[0].windows[0].panes).toHaveLength(20);
    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(8);
  });
});
