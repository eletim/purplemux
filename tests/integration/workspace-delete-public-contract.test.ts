import { execFile, execFileSync, spawn, type ChildProcess } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { encodeStdin, encodeWebStdin, encodeResize, encodeKillSession, MSG_STDOUT } from '@/lib/terminal-protocol';

const execFileAsync = promisify(execFile);
const waitFor = (assertion: () => unknown) => vi.waitFor(assertion, { timeout: 5000 });
const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, 'bin', 'purplemux.js');
const children: ChildProcess[] = [];
const tempHomes: string[] = [];
const viewers: WebSocket[] = [];
const tmuxSockets: string[] = [];

const waitForServer = async (home: string): Promise<number> => {
  const portFile = path.join(home, '.purplemux', 'port');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const port = Number(await fs.readFile(portFile, 'utf8'));
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return port;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the integration server');
};

afterEach(async () => {
  viewers.splice(0).forEach((ws) => ws.terminate());
  await Promise.all(children.splice(0).map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  })));
  for (const socket of tmuxSockets.splice(0)) {
    try { execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'ignore' }); } catch {}
  }
  await Promise.all(tempHomes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true, maxRetries: 5 })));
});

// Keep real Next server tests in this file so they run sequentially and do not
// contend for the development build lock. Browser component coverage lives in
// ext-review-browser-pages.test.ts; here its HTTP/WS contracts use the real server.
describe('external Review public boundary contract', () => {
  it('runs CLI creation through browser observation and isolates every cleanup boundary', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-public-review-'));
    tempHomes.push(home);
    const base = path.join(home, '.purplemux');
    const socket = path.join(home, 'external');
    const managedSocket = path.join(home, `tmux-${process.getuid?.()}`, 'purple');
    tmuxSockets.push(socket, managedSocket);
    const tmux = (...args: string[]) => execFileSync('tmux', ['-f', '/dev/null', '-S', socket, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const managed = (...args: string[]) => execFileSync('tmux', ['-S', managedSocket, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    // Started by the fixture before purplemux, never by the Review lifecycle.
    tmux('new-session', '-d', '-s', 'external', '-n', 'approved', '-x', '90', '-y', '30',
      'echo EXTERNAL_APPROVED; exec bash --noprofile --norc');
    tmux('new-window', '-d', '-t', 'external', '-n', 'hidden', 'echo HIDDEN_SECRET; exec sleep 300');
    tmux('set-option', '-t', 'external', 'status-right', 'UNREGISTERED_STATUS_SECRET');
    const state = () => tmux('list-panes', '-a', '-F',
      '#{pid}:#{session_id}:#{session_name}:#{window_id}:#{window_name}:#{pane_id}:#{pane_width}:#{pane_height}:#{pane_pid}');
    let initial = state();
    const pids = tmux('list-panes', '-a', '-F', '#{pane_pid}').split('\n').map(Number);
    const intact = () => {
      expect(state()).toBe(initial);
      for (const pid of pids) expect(() => process.kill(pid, 0)).not.toThrow();
      expect(tmux('list-clients')).toBe('');
    };
    const emptyLayout = {
      root: { type: 'pane', id: 'pane-1', tabs: [], activeTabId: null },
      activePaneId: 'pane-1', updatedAt: '2026-09-16T00:00:00.000Z',
    };
    for (const id of ['ws-empty', 'ws-normal']) {
      await fs.mkdir(path.join(base, 'workspaces', id), { recursive: true });
      await fs.writeFile(path.join(base, 'workspaces', id, 'layout.json'), JSON.stringify(emptyLayout));
    }
    await fs.writeFile(path.join(base, 'workspaces.json'), JSON.stringify({
      workspaces: ['ws-empty', 'ws-normal'].map((id) => ({ id, name: id, directories: [home] })),
      groups: [], activeWorkspaceId: 'ws-normal', sidebarCollapsed: false, sidebarWidth: 240,
      updatedAt: emptyLayout.updatedAt,
    }));
    // The terminal PTY deliberately inherits a restricted environment without
    // TMUX_TMPDIR. Pin its default socket in a fixture-only executable so both
    // managed commands and PTY attach stay isolated from the user's purple server.
    const bin = path.join(home, 'bin');
    await fs.mkdir(bin);
    await fs.mkdir(path.dirname(managedSocket), { recursive: true });
    const realTmux = execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim();
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    await fs.writeFile(path.join(bin, 'tmux'),
      `#!/bin/sh
if [ "$1" = "-u" ] && [ "$2" = "-L" ] && [ "$3" = "purple" ]; then
  shift 3
  exec ${quote(realTmux)} -u -S ${quote(managedSocket)} "$@"
elif [ "$1" = "-L" ] && [ "$2" = "purple" ]; then
  shift 2
  exec ${quote(realTmux)} -S ${quote(managedSocket)} "$@"
fi
exec ${quote(realTmux)} "$@"
`, { mode: 0o700 });
    const env: NodeJS.ProcessEnv = {
      ...process.env, HOME: home, TMUX_TMPDIR: home, PORT: '0', HOST: 'localhost',
      PATH: `${bin}:${process.env.PATH}`, SHELL: '/bin/bash',
      INIT_PASSWORD: 'review-test-password', NEXT_TELEMETRY_DISABLED: '1', NO_UPDATE_NOTIFIER: '1',
      IS_WEBPACK_TEST: '1', WATCHPACK_POLLING: 'true',
    };
    delete env.__PMUX_PRISTINE_ENV;
    const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: repoRoot, env, stdio: 'ignore' });
    children.push(server);
    const port = await waitForServer(home);
    const origin = `http://127.0.0.1:${port}`;
    const cliEnv = { ...env, PMUX_PORT: String(port), PMUX_TOKEN: await fs.readFile(path.join(base, 'cli-token'), 'utf8') };
    const cli = async (...args: string[]) => JSON.parse((await execFileAsync(process.execPath,
      [cliPath, ...args], { env: cliEnv })).stdout);
    const create = () => cli('ext-review', 'create', '--socket', socket, '--session', 'external', '--window', '@0');
    const review = await create();
    expect(review).toMatchObject({ socketPath: socket, sessionId: '$0', windowIds: ['@0'], url: `http://localhost:${port}/ext-review/${review.id}` });
    const registration = await cli('external-target', 'register', '--socket', socket,
      '--session', 'external', '--window', '@0');
    expect(registration).toMatchObject({ socketPath: socket, sessionId: '$0', windowIds: ['@0'],
      url: `http://localhost:${port}/external-target/${registration.id}` });
    expect((await cli('external-target', 'list')).targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: registration.id, url: registration.url }),
    ]));
    expect(await cli('external-target', 'open', registration.id)).toMatchObject({
      id: registration.id, url: registration.url,
    });
    tmux('new-window', '-d', '-t', 'external', '-n', 'added', 'echo ADDED_SECRET; exec sleep 300');
    initial = state();
    pids.push(Number(tmux('display-message', '-p', '-t', '$0:@2', '#{pane_pid}')));
    expect(await cli('ext-review', 'get', review.id)).toMatchObject({ id: review.id, windowIds: ['@0'] });
    expect(await cli('external-target', 'unregister', registration.id)).toEqual({ deleted: true });
    expect((await cli('external-target', 'list')).targets).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: registration.id }),
    ]));
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{window_id}')).toBe('@0');
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'review-test-password' }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const request = (url: string, method = 'GET', body?: unknown) => fetch(`${origin}${url}`, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect((await fetch(`${origin}/ext-review/${review.id}`, { redirect: 'manual' })).status).toBe(307);
    const page = await request(`/ext-review/${review.id}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('External Review');
    expect(await (await request(`/api/cli/ext-reviews/${review.id}`)).json()).toMatchObject({ windowIds: ['@0'] });
    const connect = async (query: string, terminal = false) => {
      const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/api/${terminal ? 'terminal' : 'ext-review-terminal'}?${query}`, { headers: { Cookie: cookie } });
      viewers.push(ws);
      const frames: Buffer[] = [];
      let code: number | undefined;
      let reason = '';
      ws.on('message', (data) => frames.push(Buffer.from(data as Buffer)));
      ws.on('close', (value, message) => { code = value; reason = message.toString(); });
      await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
      return { ws, frames, code: () => code, reason: () => reason, output: () => frames.filter((frame) => frame[0] === MSG_STDOUT).map((frame) => frame.subarray(1).toString()).join('') };
    };
    const query = `reviewId=${review.id}&windowId=%400`;
    const observer = await connect(query);
    await waitFor(() => expect(observer.output()).toContain('EXTERNAL_APPROVED'));
    expect(observer.output()).not.toContain('HIDDEN_SECRET');
    expect(observer.output()).not.toContain('ADDED_SECRET');
    intact();

    // CLI credentials alone do not authorize a browser WebSocket upgrade.
    const unauthorized = new WebSocket(`${origin.replace('http:', 'ws:')}/api/ext-review-terminal?${query}`,
      { headers: { 'x-pmux-token': cliEnv.PMUX_TOKEN } });
    viewers.push(unauthorized);
    const status = await new Promise<number>((resolve, reject) => {
      unauthorized.once('unexpected-response', (_req, res) => { resolve(res.statusCode!); res.resume(); unauthorized.terminate(); });
      unauthorized.once('open', () => reject(new Error('Unauthenticated viewer opened')));
      unauthorized.on('error', () => {});
    });
    expect(status).toBe(401);
    for (const target of ['windowId=%401', 'windowId=%402', 'windowId=%40999', 'windowId=%400&socketPath=/tmp/other',
      'windowId=%400&session=external', 'windowId=%400&windowId=%401', 'windowId=%400&kill=true']) {
      const denied = await connect(`reviewId=${review.id}&${target}`);
      await waitFor(() => expect(denied.code()).toBe(1008));
      expect(denied.output()).toBe('');
      intact();
    }
    for (const mutation of [encodeStdin('exit\r'), encodeWebStdin('exit\r'), encodeResize(10, 5), encodeKillSession(),
      JSON.stringify({ type: 'send-keys', keys: 'exit' }), JSON.stringify({ type: 'rename', name: 'changed' }),
      JSON.stringify({ windowId: '@1' }), Buffer.from([255])]) {
      const denied = await connect(query);
      await waitFor(() => expect(denied.output()).toContain('EXTERNAL_APPROVED'));
      denied.ws.send(mutation);
      await waitFor(() => expect(denied.code()).toBe(1008));
      intact();
    }
    for (const method of ['PUT', 'PATCH', 'POST']) {
      expect((await request(`/api/cli/ext-reviews/${review.id}`, method, { windowIds: ['@1'], kill: true })).status).toBe(405);
    }
    intact();

    // A normal terminal still attaches, accepts input and resize, survives
    // disconnect, and permits its explicit kill operation on the managed server.
    const tab = await cli('tab', 'create', '-w', 'ws-normal', '-t', 'terminal');
    expect(managed('has-session', '-t', tab.sessionName)).toBe('');
    const normal = await connect(`session=${tab.sessionName}&cols=80&rows=24`, true);
    await waitFor(() => expect(normal.frames.length).toBeGreaterThan(0));
    // Older supported tmux versions show unsupported configuration options in
    // copy mode on first attach. Dismiss that notice before exercising input.
    if (managed('display-message', '-p', '-t', tab.sessionName, '#{pane_in_mode}') === '1') {
      managed('send-keys', '-t', tab.sessionName, '-X', 'cancel');
    }
    normal.ws.send(encodeStdin("printf 'NORMAL_%s\\n' 'OUTPUT'\r"));
    await waitFor(() => expect(normal.output()).toContain('NORMAL_OUTPUT'));
    normal.ws.send(encodeResize(100, 40));
    await waitFor(() => expect(managed('display-message', '-p', '-t', tab.sessionName, '#{pane_width}:#{pane_height}')).toBe('100:40'));
    const definitions = await fs.readFile(path.join(base, 'ext-reviews.json'), 'utf8');
    const cleanup = await request('/api/workspace/cleanup-empty', 'POST', { workspaceIds: ['ws-empty', 'ws-normal'] });
    expect(await cleanup.json()).toMatchObject({ results: [
      { workspaceId: 'ws-empty', status: 'deleted', deleted: true },
      { workspaceId: 'ws-normal', status: 'not-empty', deleted: false },
    ] });
    expect(await fs.readFile(path.join(base, 'ext-reviews.json'), 'utf8')).toBe(definitions);
    expect((await request(`/api/cli/ext-reviews/${review.id}`)).status).toBe(200);
    intact();
    normal.ws.close(1000);
    await waitFor(() => expect(normal.code()).toBe(1000));
    expect(managed('has-session', '-t', tab.sessionName)).toBe('');
    const reconnected = await connect(`session=${tab.sessionName}`, true);
    await waitFor(() => expect(reconnected.frames.length).toBeGreaterThan(0));
    reconnected.ws.send(encodeKillSession());
    await waitFor(() => expect(() => managed('has-session', '-t', tab.sessionName)).toThrow());
    intact();

    observer.ws.close(1000);
    await waitFor(() => expect(observer.code()).toBe(1000));
    intact();
    const deletedViewer = await connect(query);
    await waitFor(() => expect(deletedViewer.output()).toContain('EXTERNAL_APPROVED'));
    expect(await cli('ext-review', 'delete', review.id)).toEqual({ deleted: true });
    await waitFor(() => expect(deletedViewer.code()).toBe(1000));
    expect((await request(`/api/cli/ext-reviews/${review.id}`)).status).toBe(404);
    intact();

    const interactive = await cli('external-target', 'register', '--socket', socket,
      '--session', 'external', '--window', '@0');
    const readOnly = await create();
    const readOnlyDenied = await connect(`externalTargetId=${readOnly.id}&windowId=%400`, true);
    await waitFor(() => expect(readOnlyDenied.code()).toBe(1008));
    expect((await request(`/external-target/${interactive.id}`)).status).toBe(200);
    const external = await connect(`externalTargetId=${interactive.id}&windowId=%400&cols=90&rows=30`, true);
    await waitFor(() => expect(external.output()).toContain('EXTERNAL_APPROVED'));
    expect(external.output()).not.toContain('HIDDEN_SECRET');
    expect(external.output()).not.toContain('UNREGISTERED_STATUS_SECRET');
    external.ws.send(encodeStdin("printf 'EXTERNAL_%s\\n' 'INPUT'\r"));
    await waitFor(() => expect(external.output()).toContain('EXTERNAL_INPUT'));
    external.ws.send(encodeWebStdin("printf 'EXTERNAL_%s\\n' 'WEB_INPUT'\r"));
    await waitFor(() => expect(external.output()).toContain('EXTERNAL_WEB_INPUT'));
    external.ws.send(encodeWebStdin("for n in {1..70}; do printf 'SCROLLBACK_%03d\\n' \"$n\"; done\r"));
    await waitFor(() => expect(external.output()).toContain('SCROLLBACK_070'));
    expect(external.output()).toContain('SCROLLBACK_001');
    // Prefix navigation is delivered to the approved pane, not to the tmux client.
    external.ws.send(encodeStdin('\x02n'));
    await waitFor(() => expect(tmux('list-clients', '-F', '#{window_id}').split('\n').every((id) => id === '@0')).toBe(true));
    expect(external.output()).not.toContain('HIDDEN_SECRET');
    external.ws.send(encodeResize(100, 40));
    // Control mode has no status row, so the approved pane uses the full size.
    await waitFor(() => expect(tmux('display-message', '-p', '-t', '$0:@0', '#{pane_width}:#{pane_height}')).toBe('100:40'));
    external.ws.close(1000);
    await waitFor(() => expect(external.code()).toBe(1000));
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{window_id}')).toBe('@0');
    const refreshed = await request(`/api/cli/ext-reviews/${interactive.id}`);
    expect([refreshed.status, await refreshed.json()]).toMatchObject([200, { id: interactive.id }]);
    const resumed = await connect(`externalTargetId=${interactive.id}&windowId=%400`, true);
    await waitFor(() => expect(tmux('list-clients', '-F', '#{client_flags}')
      .split('\n').some((flags) => !flags.includes('no-output'))).toBe(true));
    resumed.ws.send(encodeKillSession());
    await waitFor(() => expect([resumed.code(), resumed.reason()]).toEqual([1008, 'External target cannot be killed']));
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{window_id}')).toBe('@0');
    const wrongWindow = await connect(`externalTargetId=${interactive.id}&windowId=%401`, true);
    await waitFor(() => expect(wrongWindow.code()).toBe(1008));
    expect(wrongWindow.output()).toBe('');
    const switched = await connect(`externalTargetId=${interactive.id}&windowId=%400`, true);
    await waitFor(() => expect(switched.output()).toContain('EXTERNAL_APPROVED'));
    const clientTty = tmux('list-clients', '-F', '#{client_flags}\t#{client_tty}')
      .split('\n').find((line) => !line.includes('no-output'))?.split('\t')[1] ?? '';
    expect(clientTty).toBeTruthy();
    tmux('switch-client', '-c', clientTty, '-t', '$0:@1');
    await waitFor(() => expect(switched.code()).toBe(1008));
    expect(switched.output()).not.toContain('HIDDEN_SECRET');
    const rapid = await connect(`externalTargetId=${interactive.id}&windowId=%400`, true);
    await waitFor(() => expect(rapid.output()).toContain('EXTERNAL_APPROVED'));
    const rapidTty = tmux('list-clients', '-F', '#{client_flags}\t#{client_tty}')
      .split('\n').find((line) => !line.includes('no-output'))?.split('\t')[1] ?? '';
    expect(rapidTty).toBeTruthy();
    tmux('switch-client', '-c', rapidTty, '-t', '$0:@1');
    tmux('switch-client', '-c', rapidTty, '-t', '$0:@0');
    tmux('send-keys', '-t', '$0:@0', '-l', 'AFTER_WINDOW_SWITCH');
    await waitFor(() => expect(rapid.code()).toBe(1008));
    expect(rapid.output()).not.toContain('HIDDEN_SECRET');
    const revocable = await connect(`externalTargetId=${interactive.id}&windowId=%400`, true);
    await waitFor(() => expect(revocable.output()).toContain('EXTERNAL_APPROVED'));
    expect(await cli('external-target', 'unregister', interactive.id)).toEqual({ deleted: true });
    await waitFor(() => expect([revocable.code(), revocable.reason()]).toEqual([1000, 'External target unregistered']));
    const unregistered = await connect(`externalTargetId=${interactive.id}&windowId=%400`, true);
    await waitFor(() => expect(unregistered.code()).toBe(1008));

    const shutdownReview = await create();
    const shutdownViewer = await connect(`reviewId=${shutdownReview.id}&windowId=%400`);
    await waitFor(() => expect(shutdownViewer.output()).toContain('SCROLLBACK_070'));
    const exited = new Promise<void>((resolve) => server.once('exit', () => resolve()));
    server.kill('SIGTERM');
    await exited;
    await waitFor(() => expect(shutdownViewer.code()).toBe(1001));
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{window_id}')).toBe('@0');
  }, 90_000);
});

describe('real public workspace deletion contract', () => {
  it('runs the shipped CLI through the real Next API route and persistent store', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-public-delete-'));
    tempHomes.push(home);
    const base = path.join(home, '.purplemux');
    const emptyLayout = {
      root: { type: 'pane', id: 'pane-1', tabs: [], activeTabId: null },
      activePaneId: 'pane-1', updatedAt: '2026-09-05T00:00:00.000Z',
    };
    await fs.mkdir(path.join(base, 'workspaces', 'ws-target'), { recursive: true });
    await fs.mkdir(path.join(base, 'workspaces', 'ws-control'), { recursive: true });
    await fs.writeFile(path.join(base, 'workspaces.json'), JSON.stringify({
      workspaces: [
        { id: 'ws-target', name: 'Target', directories: [home] },
        { id: 'ws-control', name: 'Control', directories: [home] },
      ],
      groups: [], activeWorkspaceId: 'ws-target', sidebarCollapsed: false, sidebarWidth: 240,
      updatedAt: '2026-09-05T00:00:00.000Z',
    }));
    await fs.writeFile(path.join(base, 'workspaces', 'ws-target', 'layout.json'), JSON.stringify(emptyLayout));
    await fs.writeFile(path.join(base, 'workspaces', 'ws-control', 'layout.json'), JSON.stringify(emptyLayout));

    const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        PORT: '0',
        HOST: 'localhost',
        NEXT_TELEMETRY_DISABLED: '1',
        NO_UPDATE_NOTIFIER: '1',
        IS_WEBPACK_TEST: '1', WATCHPACK_POLLING: 'true',
      },
      stdio: 'ignore',
    });
    children.push(server);
    const port = await waitForServer(home);
    const cliEnv = {
      ...process.env,
      HOME: home,
      PMUX_PORT: String(port),
      NO_UPDATE_NOTIFIER: '1',
    };

    const deleted = await execFileAsync(process.execPath, [
      cliPath, 'workspace', 'delete', '-w', 'ws-target', '--if-empty',
    ], { env: cliEnv });
    expect(JSON.parse(deleted.stdout)).toEqual({
      workspaceId: 'ws-target', status: 'deleted', deleted: true,
    });

    const absent = await execFileAsync(process.execPath, [
      cliPath, 'workspace', 'delete', '-w', 'ws-target', '--if-empty',
    ], { env: cliEnv });
    expect(JSON.parse(absent.stdout)).toEqual({
      workspaceId: 'ws-target', status: 'absent', deleted: false,
    });

    const stored = JSON.parse(await fs.readFile(path.join(base, 'workspaces.json'), 'utf8'));
    expect(stored.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual(['ws-control']);
    await expect(fs.access(path.join(base, 'workspaces', 'ws-target'))).rejects.toThrow();
    await expect(fs.access(path.join(base, 'workspaces', 'ws-control', 'layout.json'))).resolves.toBeUndefined();
  }, 40_000);
});
