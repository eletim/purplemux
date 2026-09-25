import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertExternalServerSocketIdentity, discoverExternalServer,
  externalServerTmuxTarget, resolveExternalServerWindow } from '@/lib/external-server-tmux';
import { execTmux } from '@/lib/tmux-target';

let directory: string;
let socket: string;
const tmux = (...args: string[]) => execFileSync('tmux', ['-f', '/dev/null', '-S', socket, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-external-server-'));
  socket = path.join(directory, 'tmux');
  tmux('new-session', '-d', '-s', 'external', 'sleep 300');
});

afterEach(async () => {
  try { tmux('kill-server'); } catch {}
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('external tmux server registrations', () => {
  it('persists a stable server identity and unregisters without touching tmux', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: '  dev server  ', socketPath: socket });
    expect(server).toMatchObject({ name: 'dev server', socketPath: socket });
    expect(server.id).toHaveLength(21);
    expect(server.socketIdentity).toMatch(/^\d+:\d+:\d+$/);
    expect(await store.listExternalServers()).toEqual([server]);

    tmux('new-window', '-d', '-t', 'external', 'sleep 300');
    expect(await store.unregisterExternalServer(server.id)).toBe(true);
    expect(await store.listExternalServers()).toEqual([]);
    expect(tmux('list-windows', '-t', 'external', '-F', '#{window_id}').split('\n')).toHaveLength(2);
  });

  it('creates a new session and persists exact ownership without adopting existing resources', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    const created = await store.createExternalTerminal(server.id);

    expect(created).toMatchObject({ serverId: server.id, sessionId: '$1', windowId: '@1',
      name: expect.stringMatching(/^purplemux-[A-Za-z0-9_-]{8}$/),
      provenance: { owner: 'purplemux', resourceType: 'session',
        sessionId: '$1', sessionCreated: expect.stringMatching(/^\d+$/), createdAt: expect.any(String) } });
    expect(created?.provenance.id).toHaveLength(21);
    const registrations = await store.listExternalServers();
    expect(registrations[0].ownedTerminals).toEqual([created?.provenance]);

    const inventory = await discoverExternalServer(registrations[0]);
    expect(inventory.sessions.find(({ id }) => id === '$0')).toMatchObject({ owned: false });
    expect(inventory.sessions.find(({ id }) => id === created?.sessionId)).toMatchObject({
      name: created?.name, owned: true, provenance: created?.provenance,
    });

    await expect(store.unregisterExternalServer(server.id)).resolves.toBe(true);
    expect(tmux('list-sessions', '-F', '#{session_id}:#{session_name}').split('\n'))
      .toEqual(['$0:external', `$1:${created?.name}`]);
  });

  it('rejects the managed socket and fails closed after socket replacement', async () => {
    vi.stubEnv('TMUX_TMPDIR', directory);
    const managedDirectory = path.join(directory, `tmux-${process.getuid?.()}`);
    await fs.mkdir(managedDirectory);
    await fs.link(socket, path.join(managedDirectory, 'purple'));
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    await expect(store.registerExternalServer({ name: 'managed', socketPath: socket }))
      .rejects.toThrow('not external');

    await fs.unlink(path.join(managedDirectory, 'purple'));
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    tmux('kill-server');
    tmux('new-session', '-d', '-s', 'replacement', 'sleep 300');
    await expect(assertExternalServerSocketIdentity(server)).rejects.toThrow('identity changed');
    await expect(execTmux(externalServerTmuxTarget(server), ['list-sessions']))
      .rejects.toThrow('identity changed');
    await expect(store.createExternalTerminal(server.id)).rejects.toThrow('identity changed');
  });

  it('discovers fresh sessions, windows, and pane foreground metadata without recreating deletions', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });

    let inventory = await discoverExternalServer(server);
    expect(inventory).toMatchObject({ id: server.id, exists: true, sessions: [{
      id: '$0', name: 'external', exists: true, windows: [{
        id: '@0', exists: true, active: true, panes: [{
          id: '%0', exists: true, active: true, currentCommand: 'sleep', dead: false,
        }],
      }],
    }] });
    expect(inventory.sessions[0].windows[0].panes[0]).toEqual(expect.objectContaining({
      pid: expect.any(Number), currentPath: expect.any(String), index: 0,
    }));

    tmux('link-window', '-d', '-s', '$0:@0', '-t', '$0:4');
    inventory = await discoverExternalServer(server);
    expect(inventory.sessions[0].windows.filter(({ id }) => id === '@0').map(({ index }) => index))
      .toEqual([0, 4]);

    const unusualPath = path.join(directory, '日-é-😀-path\twith\na newline');
    await fs.mkdir(unusualPath);
    tmux('new-session', '-d', '-s', 'new-session', '-c', unusualPath, 'sleep 300');
    tmux('new-window', '-d', '-t', '$0', '-n', 'fresh-window', 'sleep 300');
    inventory = await discoverExternalServer(server);
    expect(inventory.sessions.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: '$0', name: 'external' }, { id: '$1', name: 'new-session' },
    ]);
    expect(inventory.sessions[0].windows.map(({ id, name }) => ({ id, name }))).toContainEqual(
      { id: '@2', name: 'fresh-window' });
    expect(inventory.sessions[1].windows[0].panes[0].currentPath).toBe(unusualPath);

    tmux('kill-window', '-t', '$0:@2');
    inventory = await discoverExternalServer(server);
    expect(inventory.sessions[0].windows.some(({ id }) => id === '@2')).toBe(false);
    expect(tmux('list-windows', '-t', '$0', '-F', '#{window_id}').split('\n')).not.toContain('@2');

    tmux('set-option', '-g', 'exit-empty', 'off');
    tmux('kill-session', '-a', '-t', '$0');
    tmux('kill-session', '-t', '$0');
    inventory = await discoverExternalServer(server);
    expect(inventory).toMatchObject({ exists: true, sessions: [] });
    expect(inventory).not.toHaveProperty('unavailableReason');

    tmux('kill-server');
    inventory = await discoverExternalServer(server);
    expect(inventory).toMatchObject({ exists: false, sessions: [], unavailableReason: expect.any(String) });
    expect(() => tmux('list-sessions')).toThrow();
  });

  it('resolves only an exact discovered session and window on the frozen socket', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    tmux('new-window', '-d', '-t', '$0', 'sleep 300');

    await expect(resolveExternalServerWindow(server, '$0', '@0')).resolves.toMatchObject({
      kind: 'external', socketPath: socket,
    });
    await expect(resolveExternalServerWindow(server, '$1', '@0'))
      .rejects.toThrow('window is unavailable');
    await expect(resolveExternalServerWindow(server, '$0', '@999'))
      .rejects.toThrow('window is unavailable');
    await expect(resolveExternalServerWindow(server, 'external', '@0'))
      .rejects.toThrow('Invalid external tmux window target');
  });
});
