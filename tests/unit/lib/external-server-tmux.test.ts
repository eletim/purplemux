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

import { createExternalTerminal, discoverExternalServer,
  rollbackExternalTerminalCreation } from '@/lib/external-server-tmux';

describe('external tmux runtime decoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue('1:2:3');
    mocks.exec.mockResolvedValue({ stdout: '$0\t1750000000\t\t0\t@0\t0\t1\t%0\t0\t1\t123\t0\n', stderr: '' });
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

  it('creates a marked session and returns stable identities for creation history', async () => {
    mocks.exec.mockResolvedValueOnce({ stdout: '$0\t1750000000\t\t0\t@0\t0\t1\t%0\t0\t1\t123\t0\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '$4\t1750000001\t@7\n', stderr: '' });
    const identity = { id: '123456789012345678901', requestId: 'request-1',
      createdAt: '2026-09-26T00:00:00.000Z' };
    const created = await createExternalTerminal({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
    }, { requestId: 'request-1', name: 'my terminal' }, identity);

    expect(created).toEqual({ serverId: 'server', sessionId: '$4', sessionCreated: '1750000001',
      windowId: '@7', name: 'my terminal' });
    expect(mocks.exec).toHaveBeenCalledWith(expect.anything(), [
      'new-session', '-d', '-P', '-F', '#{session_id}\t#{session_created}\t#{window_id}',
      '-s', 'my terminal',
      ';', 'set-option', '-t', 'my terminal', '@purplemux_provenance',
      'v1:123456789012345678901:request-1:1790380800000',
    ], expect.objectContaining({ timeout: 5000 }));
  });

  it.each([
    { label: 'unparseable output', failure: { stdout: 'unexpected\n', stderr: '' } },
    { label: 'process error', failure: new Error('connection lost') },
  ])('recovers a marked session after $label instead of creating another', async ({ failure }) => {
    const identity = { id: '123456789012345678901', requestId: 'recover-1',
      createdAt: '2026-09-26T00:00:00.000Z' };
    const before = '$0\t1750000000\t\t0\t@0\t0\t1\t%0\t0\t1\t123\t0\n';
    const after = '$4\t1750000001\tv1:123456789012345678901:recover-1:1790380800000'
      + '\t0\t@7\t0\t1\t%8\t0\t1\t456\t0\n';
    mocks.exec.mockReset().mockResolvedValueOnce({ stdout: before, stderr: '' });
    if (failure instanceof Error) mocks.exec.mockRejectedValueOnce(failure);
    else mocks.exec.mockResolvedValueOnce(failure);
    mocks.exec.mockResolvedValueOnce({ stdout: after, stderr: '' });

    await expect(createExternalTerminal({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
    }, { requestId: 'recover-1', name: 'my terminal' }, identity)).resolves.toMatchObject({
      sessionId: '$4', sessionCreated: '1750000001', windowId: '@7',
    });
    expect(mocks.exec.mock.calls.filter(([, args]) => args[0] === 'new-session')).toHaveLength(1);
  });

  it('recovers the marked session on retry after post-creation identity validation fails', async () => {
    const identity = { id: '123456789012345678901', requestId: 'post-check',
      createdAt: '2026-09-26T00:00:00.000Z' };
    const before = '$0\t1750000000\t\t0\t@0\t0\t1\t%0\t0\t1\t123\t0\n';
    const after = '$4\t1750000001\tv1:123456789012345678901:post-check:1790380800000'
      + '\t0\t@7\t0\t1\t%8\t0\t1\t456\t0\n';
    let created = false;
    mocks.exec.mockImplementation(async (_target, args: string[]) => {
      if (args[0] === 'new-session') {
        created = true;
        return { stdout: '$4\t1750000001\t@7\n', stderr: '' };
      }
      if (args[0] === 'display-message') return { stdout: '123\n', stderr: '' };
      return { stdout: created ? after : before, stderr: '' };
    });
    mocks.identity.mockImplementation(async () => {
      if (created) throw new Error('identity changed');
      return '1:2:3';
    });
    const server = { id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3' };
    const input = { requestId: 'post-check', name: 'my terminal' };

    await expect(createExternalTerminal(server, input, identity)).rejects.toThrow('unavailable');
    mocks.identity.mockResolvedValue('1:2:3');
    await expect(createExternalTerminal(server, input, identity)).resolves.toMatchObject({
      sessionId: '$4', windowId: '@7',
    });
    expect(mocks.exec.mock.calls.filter(([, args]) => args[0] === 'new-session')).toHaveLength(1);
  });

  it('rolls back only the exact session identity created by the failed operation', async () => {
    mocks.exec.mockResolvedValue({ stdout: '', stderr: '' });
    await rollbackExternalTerminalCreation({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
    }, { sessionId: '$4', sessionCreated: '1750000001' });

    expect(mocks.exec).toHaveBeenCalledWith(expect.anything(), [
      'if-shell', '-F', '-t', '$4',
      '#{&&:#{==:#{session_id},$4},#{==:#{session_created},1750000001}}',
      'kill-session -t $4',
      'display-message -p purplemux-terminal-identity-mismatch',
    ], expect.objectContaining({ timeout: 5000 }));

    mocks.exec.mockResolvedValue({ stdout: 'purplemux-terminal-identity-mismatch\n', stderr: '' });
    await expect(rollbackExternalTerminalCreation({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
    }, { sessionId: '$4', sessionCreated: '1750000001' }))
      .rejects.toThrow('changed before ownership rollback');
  });

  it('uses only the tmux marker as live ownership authority', async () => {
    const provenance = { id: '123456789012345678901', requestId: 'persisted-request',
      owner: 'purplemux' as const, resourceType: 'session' as const,
      sessionId: '$0', sessionCreated: '1750000000', createdAt: '2026-09-26T00:00:00.000Z' };
    const server = {
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
      terminalCreations: [provenance],
    };
    const withoutMarker = await discoverExternalServer(server);
    expect(withoutMarker.sessions[0]).toMatchObject({ owned: false });
    expect(withoutMarker.sessions[0]).not.toHaveProperty('provenance');

    mocks.exec.mockResolvedValue({
      stdout: '$0\t1750000000\tv1:123456789012345678901:persisted-request:1790380800000'
        + '\t0\t@0\t0\t1\t%0\t0\t1\t123\t0\n',
      stderr: '',
    });
    const withMarker = await discoverExternalServer(server);
    expect(withMarker.sessions[0]).toMatchObject({ owned: true, provenance });
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
    const stale = '$0\t1750000000\t\t0\t@0\t0\t1\t%0\t0\t0\t123\t0\n'
      + '$0\t1750000000\t\t0\t@0\t0\t1\t%1\t1\t1\t124\t0\n';
    const survivor = '$0\t1750000000\t\t0\t@0\t0\t1\t%1\t0\t1\t124\t0\n';
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
      `$0\t1750000000\t\t0\t@0\t0\t1\t%${pane}\t${pane}\t${pane === 0 ? 1 : 0}\t${100 + pane}\t0`).join('\n') + '\n', stderr: '' });
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
