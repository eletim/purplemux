import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertExternalServerSocketIdentity, captureExternalServerWindow, discoverExternalServer,
  externalServerTmuxTarget, resolveExternalServerWindow } from '@/lib/external-server-tmux';
import { ExternalTerminalClientResource } from '@/lib/external-terminal-client';
import { registeredExternalTerminalSessions,
  unregisterExternalTerminalSession } from '@/lib/external-terminal-session-registry';
import { execTmux, externalTmuxTarget } from '@/lib/tmux-target';

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

  it('does not trust or delimit inventory with user-provided internal marker options', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });

    tmux('set-option', '-t', '$0', '@purplemux_internal_external_client', 'user\tvalue\nnext');
    let inventory = await discoverExternalServer(server);
    expect(inventory.sessions.map(({ id }) => id)).toEqual(['$0']);

    tmux('set-option', '-t', '$0', '@purplemux_internal_external_client',
      'v1:12345678-1234-4123-8123-123456789abc');
    inventory = await discoverExternalServer(server);
    expect(inventory.sessions.map(({ id }) => id)).toEqual(['$0']);
  });

  it('hides a shadow session throughout initialization', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    const stableBackend = externalServerTmuxTarget(server);
    if (stableBackend.kind !== 'external') throw new Error('expected external backend');
    let validations = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gatedBackend = externalTmuxTarget(socket, async (signal) => {
      await stableBackend.validate(signal);
      validations += 1;
      if (validations === 4) await gate;
    });
    const creating = ExternalTerminalClientResource.create(
      gatedBackend, '$0', '@0', server.socketIdentity);
    void creating.catch(() => {});

    await vi.waitFor(() => expect(tmux('list-sessions', '-F', '#{session_id}').split('\n'))
      .toHaveLength(2));
    const pending = registeredExternalTerminalSessions(server.socketIdentity);
    expect(pending).toHaveLength(1);
    expect(tmux('display-message', '-p', '-t', `=${pending[0].sessionName}:`, '#{session_id}')).toBe('$1');
    expect((await discoverExternalServer(server)).sessions.map(({ id }) => id)).toEqual(['$0']);

    release();
    const resource = await creating;
    await resource.stop();
  });

  it('hides a shadow discovered through a hard link to the same socket', async () => {
    const linkedSocket = path.join(directory, 'tmux-linked');
    await fs.link(socket, linkedSocket);
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const direct = await store.registerExternalServer({ name: 'direct', socketPath: socket });
    const linked = await store.registerExternalServer({ name: 'linked', socketPath: linkedSocket });
    expect(linked.socketIdentity).toBe(direct.socketIdentity);
    const resource = await ExternalTerminalClientResource.create(
      externalServerTmuxTarget(direct), '$0', '@0', direct.socketIdentity);

    expect(tmux('list-sessions', '-F', '#{session_id}').split('\n')).toHaveLength(2);
    expect((await discoverExternalServer(linked)).sessions.map(({ id }) => id)).toEqual(['$0']);

    await resource.stop();
  }, 30_000);

  it('serializes slow identity probes and aborts the active probe during shutdown', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    const stableBackend = externalServerTmuxTarget(server);
    if (stableBackend.kind !== 'external') throw new Error('expected external backend');
    let slow = false;
    let activeProbes = 0;
    let peakProbes = 0;
    let abortedProbes = 0;
    let probeStarted!: () => void;
    const firstProbe = new Promise<void>((resolve) => { probeStarted = resolve; });
    const backend = externalTmuxTarget(socket, async (signal) => {
      await stableBackend.validate(signal);
      if (!slow || !signal) return;
      activeProbes += 1;
      peakProbes = Math.max(peakProbes, activeProbes);
      probeStarted();
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => {
          activeProbes -= 1;
          abortedProbes += 1;
          reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    });
    const resource = await ExternalTerminalClientResource.create(
      backend, '$0', '@0', server.socketIdentity);

    slow = true;
    await firstProbe;
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(activeProbes).toBe(1);
    expect(peakProbes).toBe(1);

    await resource.stop();
    expect(activeProbes).toBe(0);
    expect(abortedProbes).toBe(1);
  });

  it('identity-verifies and deletes a shadow when destroy-unattached is ineffective', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    const resource = await ExternalTerminalClientResource.create(
      externalServerTmuxTarget(server), '$0', '@0', server.socketIdentity);
    const shadow = tmux('list-sessions', '-F',
      '#{session_id}\t#{session_name}\t#{@purplemux_internal_external_client}')
      .split('\n').find((line) => line.includes('\tv1:'))?.split('\t');
    expect(shadow).toHaveLength(3);
    tmux('set-option', '-t', shadow![0], 'destroy-unattached', 'off');

    await resource.stop();

    expect(() => tmux('has-session', '-t', shadow![0])).toThrow();
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{session_id}\t#{window_id}'))
      .toBe('$0\t@0');

    // Model a new PurpleMux process with no process-local shadow registrations.
    const runtime = globalThis as typeof globalThis & {
      __purplemux_external_terminal_sessions?: unknown;
    };
    const registrations = runtime.__purplemux_external_terminal_sessions;
    delete runtime.__purplemux_external_terminal_sessions;
    vi.resetModules();
    try {
      const restarted = await import('@/lib/external-server-tmux');
      expect((await restarted.discoverExternalServer(server)).sessions.map(({ id }) => id))
        .toEqual(['$0']);
    } finally {
      runtime.__purplemux_external_terminal_sessions = registrations;
    }
  }, 30_000);

  it('does not delete a shadow whose ownership marker changed', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    const resource = await ExternalTerminalClientResource.create(
      externalServerTmuxTarget(server), '$0', '@0', server.socketIdentity);
    const registration = registeredExternalTerminalSessions(server.socketIdentity)[0]!;
    expect(registration).toBeDefined();
    const shadowId = tmux('display-message', '-p', '-t', `=${registration.sessionName}:`,
      '#{session_id}');
    tmux('set-option', '-t', shadowId, 'destroy-unattached', 'off');
    tmux('set-option', '-t', shadowId, '@purplemux_internal_external_client',
      'v1:00000000-0000-4000-8000-000000000000');

    await resource.stop();

    expect(tmux('has-session', '-t', shadowId)).toBe('');
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{session_id}\t#{window_id}'))
      .toBe('$0\t@0');
    tmux('kill-session', '-t', shadowId);
    unregisterExternalTerminalSession(registration);
  }, 30_000);

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

  it('adapts window links in the same and different sessions with their session targets', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const adapter = await import('@/lib/external-workspace-adapter');
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    tmux('link-window', '-d', '-s', '$0:@0', '-t', '$0:4');
    tmux('new-session', '-d', '-s', 'linked', '-n', 'placeholder', 'sleep 300');
    const linkedSessionId = tmux('display-message', '-p', '-t', 'linked:', '#{session_id}');
    tmux('link-window', '-d', '-s', '$0:@0', '-t', `${linkedSessionId}:3`);

    const source = await adapter.getExternalWorkspaceSource(server.id);
    const original = source?.workspaces.find(({ id }) => id === '$0');
    const linked = source?.workspaces.find(({ id }) => id === linkedSessionId);

    expect(original?.tabs.filter(({ id }) => id === '@0').map(({ order }) => order))
      .toEqual([0, 4]);
    expect(original?.tabs.filter(({ id }) => id === '@0').map(({ externalTerminalTarget }) =>
      externalTerminalTarget)).toEqual([
      { serverId: server.id, sessionId: '$0', windowId: '@0' },
      { serverId: server.id, sessionId: '$0', windowId: '@0' },
    ]);
    expect(linked?.tabs.find(({ id }) => id === '@0')?.externalTerminalTarget).toEqual({
      serverId: server.id, sessionId: linkedSessionId, windowId: '@0',
    });
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
    await vi.waitFor(() => {
      try { tmux('has-session', '-t', 'replacement'); }
      catch { tmux('new-session', '-d', '-s', 'replacement', 'sleep 300'); }
    }, { timeout: 5000 });
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
