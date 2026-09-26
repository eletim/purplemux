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
import { createExternalSessionWindow, discoverExternalServer } from '@/lib/external-server-tmux';

const server = { id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3' };
const inventoryLine = (sessionId = '$0', sessionCreated = '1750000000', windowId = '@0') =>
  `${sessionId}\t${sessionCreated}\t0\t${windowId}\t0\t1\t%0\t0\t1\t123\t0\n`;

describe('external tmux runtime decoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue('1:2:3');
    mocks.exec.mockResolvedValue({ stdout: inventoryLine(), stderr: '' });
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

  it('adds an unowned window to one exact stable external session', async () => {
    mocks.exec.mockReset()
      .mockResolvedValueOnce({ stdout: inventoryLine('$4', '1750000001', '@2'), stderr: '' })
      .mockResolvedValueOnce({ stdout: '$4\t1750000001\t@7\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    await expect(createExternalSessionWindow(server,
      { id: '$4', sessionCreated: '1750000001', requestId: 'window-request' })).resolves.toEqual({
      serverId: 'server', sessionId: '$4', sessionCreated: '1750000001', windowId: '@7',
      requestId: 'window-request',
    });

    expect(mocks.exec).toHaveBeenCalledTimes(3);
    expect(mocks.exec).toHaveBeenCalledWith(expect.anything(), [
      'if-shell', '-F', '-t', '$4',
      '#{&&:#{==:#{session_id},$4},#{==:#{session_created},1750000001}}',
      "new-window -d -P -F '#{session_id}\t#{session_created}\t#{window_id}' "
        + '-n purplemux-pending-window-request -t $4',
      'display-message -p purplemux-session-identity-mismatch',
    ], expect.objectContaining({ timeout: 5000 }));
    expect(mocks.exec).toHaveBeenCalledWith(expect.anything(), [
      'set-option', '-w', '-t', '$4:@7', '@purplemux_tab_request_id', 'window-request',
      ';', 'set-option', '-wu', '-t', '$4:@7', 'automatic-rename',
      ';', 'rename-window', '-t', '$4:@7', '#{pane_current_command}',
    ], expect.objectContaining({ timeout: 5000 }));
    expect(mocks.exec.mock.calls[1][1].join(' ')).not.toContain('new-session');
    expect(mocks.exec.mock.calls[1][1].join(' ')).not.toContain('@purplemux_provenance');
  });

  it('does not overwrite a user active-window change after discovery', async () => {
    let activeWindow = '@2';
    mocks.exec.mockReset().mockImplementation(async (_target, args: string[]) => {
      if (args[0] === 'list-panes') {
        return { stdout: inventoryLine('$4', '1750000001', activeWindow), stderr: '' };
      }
      if (args[0] === 'if-shell') {
        // Another client selects a different window after discovery and before creation.
        activeWindow = '@3';
        return { stdout: '$4\t1750000001\t@7\n', stderr: '' };
      }
      if (args[0] === 'select-window') activeWindow = String(args.at(-1)).split(':').at(-1)!;
      return { stdout: '', stderr: '' };
    });

    await createExternalSessionWindow(server,
      { id: '$4', sessionCreated: '1750000001', requestId: 'window-race' });

    expect(activeWindow).toBe('@3');
    expect(mocks.exec.mock.calls.flatMap(([, args]) => args)).not.toContain('select-window');
    expect(mocks.exec).toHaveBeenCalledWith(expect.anything(), [
      'set-option', '-w', '-t', '$4:@7', '@purplemux_tab_request_id', 'window-race',
      ';', 'set-option', '-wu', '-t', '$4:@7', 'automatic-rename',
      ';', 'rename-window', '-t', '$4:@7', '#{pane_current_command}',
    ], expect.anything());
  });

  it('fails closed when the external session identity drifts or output names another target', async () => {
    mocks.exec.mockReset()
      .mockResolvedValueOnce({ stdout: inventoryLine('$4', '1750000001', '@2'), stderr: '' })
      .mockResolvedValueOnce({ stdout: 'purplemux-session-identity-mismatch\n', stderr: '' });
    await expect(createExternalSessionWindow(server,
      { id: '$4', sessionCreated: '1750000001', requestId: 'window-drift' }))
      .rejects.toThrow('session identity changed');

    mocks.exec.mockReset()
      .mockResolvedValueOnce({ stdout: inventoryLine('$4', '1750000001', '@2'), stderr: '' })
      .mockResolvedValueOnce({ stdout: '$5\t1750000001\t@7\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: inventoryLine('$4', '1750000001', '@2'), stderr: '' });
    await expect(createExternalSessionWindow(server,
      { id: '$4', sessionCreated: '1750000001', requestId: 'window-invalid' }))
      .rejects.toThrow('outcome is unknown');
  });

  it('reconciles a repeated window request after the successful response is lost', async () => {
    mocks.exec.mockReset()
      .mockResolvedValueOnce({ stdout: inventoryLine('$4', '1750000001', '@2'), stderr: '' })
      .mockResolvedValueOnce({ stdout: '$4\t1750000001\t@7\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: inventoryLine('$4', '1750000001', '@7'), stderr: '' });
    let markerReads = 0;
    mocks.execBuffer.mockImplementation(async (_target, args: string[]) => {
      const field = args.at(-1) ?? '';
      const values: Record<string, string> = {
        '#{session_name}': 'work', '#{window_name}': 'shell',
        '#{pane_current_command}': 'bash', '#{pane_current_path}': '/tmp',
      };
      const value = field === '#{@purplemux_tab_request_id}'
        ? (++markerReads === 1 ? '' : 'retry-window')
        : values[field] ?? '';
      return { stdout: Buffer.from(`${value}\n`), stderr: Buffer.alloc(0) };
    });
    const request = { id: '$4', sessionCreated: '1750000001', requestId: 'retry-window' };

    const first = await createExternalSessionWindow(server, request);
    const retried = await createExternalSessionWindow(server, request);

    expect(retried).toEqual(first);
    expect(first.windowId).toBe('@7');
    expect(mocks.exec.mock.calls.filter(([, args]) => args[0] === 'if-shell')).toHaveLength(1);
  });

  it('retries marking a pending window without dispatching another new-window', async () => {
    let created = false;
    let markerFailures = 2;
    mocks.exec.mockReset().mockImplementation(async (_target, args: string[]) => {
      if (args[0] === 'list-panes') {
        return { stdout: inventoryLine('$4', '1750000001', created ? '@7' : '@2'), stderr: '' };
      }
      if (args[0] === 'if-shell') {
        created = true;
        return { stdout: '$4\t1750000001\t@7\n', stderr: '' };
      }
      if (args[0] === 'set-option' && markerFailures-- > 0) {
        throw new Error('marker dispatch failed');
      }
      return { stdout: '', stderr: '' };
    });
    mocks.execBuffer.mockImplementation(async (_target, args: string[]) => {
      const field = args.at(-1) ?? '';
      const values: Record<string, string> = {
        '#{session_name}': 'work',
        '#{window_name}': created ? 'purplemux-pending-retry-pending' : 'shell',
        '#{pane_current_command}': 'bash', '#{pane_current_path}': '/tmp',
      };
      return { stdout: Buffer.from(`${values[field] ?? ''}\n`), stderr: Buffer.alloc(0) };
    });
    const request = { id: '$4', sessionCreated: '1750000001', requestId: 'retry-pending' };

    await expect(createExternalSessionWindow(server, request)).rejects.toThrow('outcome is unknown');
    await expect(createExternalSessionWindow(server, request)).resolves.toMatchObject({ windowId: '@7' });

    expect(mocks.exec.mock.calls.filter(([, args]) => args[0] === 'if-shell')).toHaveLength(1);
    expect(mocks.exec.mock.calls.filter(([, args]) => args[0] === 'set-option')).toHaveLength(3);
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
