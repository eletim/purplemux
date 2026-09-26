import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertExternalServerSocketIdentity, captureExternalServerWindow, discoverExternalServer,
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
  it('drops legacy ownership and creation-history fields from registrations', async () => {
    const dataDirectory = path.join(directory, '.purplemux');
    const registrationFile = path.join(dataDirectory, 'external-servers.json');
    const markerKeyFile = path.join(dataDirectory, 'external-terminal-marker-key');
    await fs.mkdir(dataDirectory);
    await fs.writeFile(registrationFile, JSON.stringify([{
      id: 'legacy-server', name: 'legacy', socketPath: socket, socketIdentity: '1:2:3',
      ownedTerminals: [{ id: 'legacy-owned' }],
      terminalCreations: [{ id: 'legacy-creation' }],
    }]));
    await fs.writeFile(markerKeyFile, 'obsolete-secret');
    const tmuxState = tmux('list-panes', '-a', '-F', '#{session_id}:#{window_id}:#{pane_id}:#{pane_pid}');
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');

    const sanitized = [{
      id: 'legacy-server', name: 'legacy', socketPath: socket, socketIdentity: '1:2:3',
    }];
    expect(await store.listExternalServers()).toEqual(sanitized);
    expect(JSON.parse(await fs.readFile(registrationFile, 'utf8'))).toEqual(sanitized);
    await expect(fs.access(markerKeyFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(tmux('list-panes', '-a', '-F', '#{session_id}:#{window_id}:#{pane_id}:#{pane_pid}'))
      .toBe(tmuxState);
  });

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

  it('adds an unowned window to an exact existing session for immediate selection', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    const sessionCreated = tmux('display-message', '-p', '-t', '$0', '#{session_created}');

    const created = await store.createExternalSessionWindow(server.id,
      { id: '$0', sessionCreated, requestId: 'window-create-1' });

    expect(created).toEqual({
      serverId: server.id, sessionId: '$0', sessionCreated, windowId: '@1',
      requestId: 'window-create-1',
    });
    expect(tmux('list-sessions', '-F', '#{session_id}')).toBe('$0');
    expect(tmux('display-message', '-p', '-t', '$0:@1',
      '#{session_id}:#{session_created}:#{window_id}')).toBe(`$0:${sessionCreated}:@1`);
    await expect(store.createExternalSessionWindow(server.id,
      { id: '$0', sessionCreated, requestId: 'window-create-1' })).resolves.toEqual(created);
    expect(tmux('list-windows', '-t', '$0', '-F', '#{window_id}').split('\n')).toEqual(['@0', '@1']);
    expect(tmux('show-options', '-v', '-t', '$0', '@purplemux_provenance')).toBe('');

    await expect(store.createExternalSessionWindow(server.id,
      { id: '$0', sessionCreated: String(Number(sessionCreated) - 1), requestId: 'window-drift' }))
      .rejects.toThrow('session identity changed');
    expect(tmux('list-windows', '-t', '$0', '-F', '#{window_id}').split('\n')).toEqual(['@0', '@1']);
    await expect(store.createExternalSessionWindow('missing',
      { id: '$0', sessionCreated, requestId: 'window-missing' }))
      .resolves.toBeUndefined();
  });

  it('adapts live sessions and windows without re-registration or workspace persistence', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const adapter = await import('@/lib/external-workspace-adapter');
    const server = await store.registerExternalServer({ name: 'external source', socketPath: socket });
    const registrationFile = path.join(directory, '.purplemux', 'external-servers.json');
    const persistedRegistration = await fs.readFile(registrationFile, 'utf8');

    let source = await adapter.getExternalWorkspaceSource(server.id);
    expect(source).toMatchObject({ serverId: server.id, name: 'external source', exists: true,
      workspaces: [{ id: '$0', name: 'external', tabs: [{ id: '@0' }] }] });

    tmux('new-session', '-d', '-s', 'live-added', 'sleep 300');
    const addedSessionId = tmux('display-message', '-p', '-t', 'live-added', '#{session_id}');
    const addedCreated = tmux('display-message', '-p', '-t', addedSessionId, '#{session_created}');
    source = await adapter.getExternalWorkspaceSource(server.id);
    expect(source?.workspaces.map(({ id, name }) => ({ id, name }))).toContainEqual({
      id: addedSessionId, name: 'live-added',
    });

    const created = await adapter.createExternalWorkspaceTab(server.id,
      { id: addedSessionId, sessionCreated: addedCreated, requestId: 'adapter-window-1' });
    expect(created).toMatchObject({ workspaceId: addedSessionId,
      externalTerminalTarget: { serverId: server.id, sessionId: addedSessionId } });
    source = await adapter.getExternalWorkspaceSource(server.id);
    expect(source?.workspaces.find(({ id }) => id === addedSessionId)?.tabs
      .map(({ id }) => id)).toContain(created?.tabId);

    tmux('kill-window', '-t', `${addedSessionId}:${created?.tabId}`);
    tmux('kill-session', '-t', addedSessionId);
    source = await adapter.getExternalWorkspaceSource(server.id);
    expect(source?.workspaces.some(({ id }) => id === addedSessionId)).toBe(false);
    expect(await fs.readFile(registrationFile, 'utf8')).toBe(persistedRegistration);
    await expect(fs.access(path.join(directory, '.purplemux', 'workspaces.json'))).rejects.toThrow();
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
    const sessionCreated = tmux('display-message', '-p', '-t', '$0', '#{session_created}');
    tmux('kill-server');
    tmux('new-session', '-d', '-s', 'replacement', 'sleep 300');
    await expect(assertExternalServerSocketIdentity(server)).rejects.toThrow('identity changed');
    await expect(execTmux(externalServerTmuxTarget(server), ['list-sessions']))
      .rejects.toThrow('identity changed');
    await expect(store.createExternalSessionWindow(server.id,
      { id: '$0', sessionCreated, requestId: 'replaced-window' }))
      .rejects.toThrow('identity changed');
    expect(tmux('list-windows', '-t', '$0', '-F', '#{window_id}')).toBe('@0');
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

  it('captures only an exact external stable target', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    tmux('respawn-pane', '-k', '-t', '$0:@0', 'printf EXTERNAL_COPY_TARGET; sleep 300');

    await vi.waitFor(async () => expect(await captureExternalServerWindow(server, '$0', '@0'))
      .toContain('EXTERNAL_COPY_TARGET'));
    await expect(captureExternalServerWindow(server, '$0', '@999'))
      .rejects.toThrow('window is unavailable');
  });
});
