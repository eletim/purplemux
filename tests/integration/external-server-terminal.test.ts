import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  encodeResize,
  encodeKillSession,
  encodeStdin,
  encodeWebStdin,
  MSG_STDOUT,
} from '@/lib/terminal-protocol';

let directory: string;
let socketPath: string;
let server: Server;
let wss: WebSocketServer;
let origin: string;
let registrationId: string;
let forcedServerBufferedAmount: number | null;
const clients: WebSocket[] = [];

const tmux = (...args: string[]) => execFileSync('tmux', ['-f', '/dev/null', '-S', socketPath, ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

const connect = async (sessionId = '$0', windowId = '@0') => {
  const query = new URLSearchParams({
    externalServerId: registrationId,
    sessionId,
    windowId,
    cols: '90',
    rows: '30',
  });
  const ws = new WebSocket(`${origin}/api/terminal?${query}`);
  clients.push(ws);
  const frames: Buffer[] = [];
  let closed: { code: number; reason: string } | undefined;
  ws.on('message', (data) => frames.push(Buffer.from(data as Buffer)));
  ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    output: () => frames.filter((frame) => frame[0] === MSG_STDOUT)
      .map((frame) => frame.subarray(1).toString()).join(''),
    closed: () => closed,
  };
};

beforeEach(async () => {
  forcedServerBufferedAmount = null;
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-external-terminal-'));
  socketPath = path.join(directory, 'tmux');
  tmux('new-session', '-d', '-s', 'external', '-n', 'first', '-x', '90', '-y', '30',
    "printf 'FIRST_WINDOW\\n'; exec bash --noprofile --norc");
  tmux('new-window', '-d', '-t', '$0', '-n', 'second',
    "printf 'SECOND_WINDOW\\n'; exec bash --noprofile --norc");
  vi.spyOn(os, 'homedir').mockReturnValue(directory);
  vi.resetModules();
  const store = await import('@/lib/external-server-store');
  registrationId = (await store.registerExternalServer({
    name: 'external',
    socketPath,
  })).id;
  const { handleConnection } = await import('@/lib/terminal-server');
  server = createServer();
  wss = new WebSocketServer({ server });
  wss.on('connection', (ws, request) => {
    if (forcedServerBufferedAmount !== null) {
      vi.spyOn(ws, 'bufferedAmount', 'get').mockImplementation(() => forcedServerBufferedAmount ?? 0);
    }
    void handleConnection(ws, request, null);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  clients.splice(0).forEach((client) => client.terminate());
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { tmux('kill-server'); } catch { /* already stopped */ }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('shared terminal path for discovered external windows', () => {
  it('rejects kill frames while the external target is still resolving', async () => {
    const store = await import('@/lib/external-server-store');
    const getExternalServer = store.getExternalServer;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const lookup = vi.spyOn(store, 'getExternalServer').mockImplementation(async (...args) => {
      await gate;
      return getExternalServer(...args);
    });

    const connected = await connect();
    try {
      connected.ws.send(encodeKillSession());
      await vi.waitFor(() => expect(connected.closed()).toEqual({
        code: 1008,
        reason: 'External target cannot be killed',
      }));
      expect(lookup).toHaveBeenCalledWith(registrationId);
      expect(tmux('display-message', '-p', '-t', '$0:@0', '#{window_id}')).toBe('@0');
    } finally {
      release();
    }
  });

  it('shares display, input, web input, resize, scrollback, reconnect, and switching behavior', async () => {
    tmux('send-keys', '-t', '$0:@0',
      "for n in {1..45}; do printf 'PREEXISTING_%03d\\n' \"$n\"; done", 'Enter');
    await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-S', '-50', '-t', '$0:@0'))
      .toContain('PREEXISTING_045'));
    expect(tmux('capture-pane', '-p', '-t', '$0:@0')).not.toContain('PREEXISTING_001');

    const first = await connect();
    await vi.waitFor(() => expect(first.output()).toContain('FIRST_WINDOW'));
    expect(first.output()).toContain('PREEXISTING_001');
    expect(first.output()).toContain('PREEXISTING_045');
    expect(tmux('list-clients', '-F', '#{client_flags}').split('\n')
      .every((flags) => flags.includes('read-only'))).toBe(true);

    first.ws.send(encodeStdin('\x02n'));
    await vi.waitFor(() => expect(tmux('list-clients', '-F', '#{window_id}').split('\n'))
      .toEqual(['@0', '@0']));
    first.ws.send(encodeStdin('\x03'));
    first.ws.send(encodeStdin("printf 'KEYBOARD_INPUT\\n'\r"));
    await vi.waitFor(() => expect(first.output()).toContain('KEYBOARD_INPUT'));

    tmux('copy-mode', '-t', '$0:@0');
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{pane_in_mode}')).toBe('1');
    first.ws.send(encodeWebStdin("printf 'WEB_INPUT\\n'\r"));
    await vi.waitFor(() => expect(first.output()).toContain('WEB_INPUT'));
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{pane_in_mode}')).toBe('0');

    first.ws.send(encodeResize(100, 40));
    await vi.waitFor(() => expect(
      tmux('display-message', '-p', '-t', '$0:@0', '#{pane_width}:#{pane_height}'),
    ).toBe('100:39'));

    first.ws.send(encodeWebStdin(
      "for n in {1..45}; do printf 'LIVE_HISTORY_%03d\\n' \"$n\"; sleep 0.01; done\r",
    ));
    await vi.waitFor(() => expect(first.output()).toContain('LIVE_HISTORY_045'));
    expect(first.output()).toContain('LIVE_HISTORY_001');
    expect(tmux('capture-pane', '-p', '-t', '$0:@0')).not.toContain('LIVE_HISTORY_001');
    first.ws.close(1000);
    await vi.waitFor(() => expect(first.closed()?.code).toBe(1000));

    const resumed = await connect();
    await vi.waitFor(() => expect(resumed.output()).toContain('LIVE_HISTORY_045'));
    expect(resumed.output()).toContain('LIVE_HISTORY_001');
    resumed.ws.close(1000);
    await vi.waitFor(() => expect(resumed.closed()?.code).toBe(1000));

    const second = await connect('$0', '@1');
    await vi.waitFor(() => expect(second.output()).toContain('SECOND_WINDOW'));
    expect(second.output()).not.toContain('FIRST_WINDOW');
  }, 30_000);

  it('preserves output produced while history and live attachment are initialized', async () => {
    tmux('send-keys', '-t', '$0:@0',
      "for n in {1..120}; do printf 'ACTIVE_ATTACH_%03d\\n' \"$n\"; sleep 0.01; done", 'Enter');
    await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-t', '$0:@0'))
      .toContain('ACTIVE_ATTACH_005'));

    const connected = await connect();
    const outputLines = () => new Set(
      [...connected.output().matchAll(/ACTIVE_ATTACH_(\d{3})/g)].map((match) => match[1]),
    );
    await vi.waitFor(() => expect(outputLines().size).toBe(120), { timeout: 5000 });
    expect([...outputLines()].sort()).toEqual(
      Array.from({ length: 120 }, (_, index) => String(index + 1).padStart(3, '0')),
    );
    expect(tmux('capture-pane', '-p', '-t', '$0:@0')).not.toContain('ACTIVE_ATTACH_001');
  }, 10_000);

  it('resumes after a large initial scrollback drains without further PTY output', async () => {
    tmux('set-option', '-g', 'history-limit', '7000');
    tmux('new-window', '-d', '-t', '$0', '-n', 'large', 'exec bash --noprofile --norc');
    tmux('resize-window', '-t', '$0:@2', '-x', '300', '-y', '30');
    tmux('send-keys', '-t', '$0:@2',
      "for n in {1..5200}; do printf 'LARGE_SCROLLBACK_%04d:%0270d\\n' \"$n\" 0; done", 'Enter');
    await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-S', '-10', '-t', '$0:@2'))
      .toContain('LARGE_SCROLLBACK_5200'), { timeout: 5000 });

    forcedServerBufferedAmount = 2 * 1024 * 1024;
    const connected = await connect('$0', '@2');
    await vi.waitFor(() => expect(connected.output()).toContain('LARGE_SCROLLBACK_5200'), {
      timeout: 10_000,
    });
    expect(Buffer.byteLength(connected.output())).toBeGreaterThan(1024 * 1024);

    tmux('send-keys', '-t', '$0:@2', "printf 'AFTER_SCROLLBACK_DRAIN\\n'", 'Enter');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(connected.output()).not.toContain('AFTER_SCROLLBACK_DRAIN');

    forcedServerBufferedAmount = 0;
    await vi.waitFor(() => expect(connected.output()).toContain('AFTER_SCROLLBACK_DRAIN'), {
      timeout: 5000,
    });
  }, 20_000);

  it('fails closed for mismatched identities and a replaced socket', async () => {
    const malformed = await connect('external', '@0');
    await vi.waitFor(() => expect(malformed.closed()?.code).toBe(1008));
    expect(malformed.output()).toBe('');

    const wrongSession = await connect('$9', '@0');
    await vi.waitFor(() => expect(wrongSession.closed()?.code).toBe(1011));
    expect(wrongSession.output()).toBe('');

    const wrongWindow = await connect('$0', '@9');
    await vi.waitFor(() => expect(wrongWindow.closed()?.code).toBe(1011));
    expect(wrongWindow.output()).toBe('');

    tmux('kill-server');
    tmux('new-session', '-d', '-s', 'replacement', 'sleep 300');
    const replaced = await connect('$0', '@0');
    await vi.waitFor(() => expect(replaced.closed()?.code).toBe(1011));
    expect(replaced.output()).toBe('');
  }, 20_000);

  it('rejects client drift before input, resize, or another window output can cross the boundary', async () => {
    const connected = await connect();
    await vi.waitFor(() => expect(connected.output()).toContain('FIRST_WINDOW'));
    const clientTty = tmux('list-clients', '-F', '#{client_flags}\t#{client_tty}')
      .split('\n').find((line) => !line.includes('no-output'))?.split('\t')[1];
    expect(clientTty).toBeTruthy();

    tmux('switch-client', '-c', clientTty!, '-t', '$0:@1');
    const secondSize = tmux('display-message', '-p', '-t', '$0:@1', '#{pane_width}:#{pane_height}');
    connected.ws.send(encodeStdin("printf 'MISROUTED_INPUT\\n'\r"));
    connected.ws.send(encodeResize(120, 50));

    await vi.waitFor(() => expect(connected.closed()?.code).toBe(1008));
    expect(tmux('capture-pane', '-p', '-t', '$0:@1')).not.toContain('MISROUTED_INPUT');
    expect(tmux('display-message', '-p', '-t', '$0:@1', '#{pane_width}:#{pane_height}'))
      .toBe(secondSize);
    expect(connected.output()).not.toContain('SECOND_WINDOW');
  });

  it('rejects a client moved to another session linked to the authorized window', async () => {
    const connected = await connect();
    await vi.waitFor(() => expect(connected.output()).toContain('FIRST_WINDOW'));
    const clientTty = tmux('list-clients', '-F', '#{client_flags}\t#{client_tty}')
      .split('\n').find((line) => !line.includes('no-output'))?.split('\t')[1];
    expect(clientTty).toBeTruthy();

    tmux('new-session', '-d', '-s', 'linked', '-n', 'placeholder', 'sleep 300');
    const linkedSessionId = tmux('display-message', '-p', '-t', 'linked:', '#{session_id}');
    tmux('link-window', '-s', '$0:@0', '-t', `${linkedSessionId}:1`);
    tmux('kill-window', '-t', `${linkedSessionId}:0`);
    expect(tmux('display-message', '-p', '-t', `${linkedSessionId}:@0`,
      '#{session_id}:#{window_id}')).toBe(`${linkedSessionId}:@0`);

    tmux('switch-client', '-c', clientTty!, '-t', `${linkedSessionId}:@0`);
    const approvedSize = tmux('display-message', '-p', '-t', '$0:@0', '#{pane_width}:#{pane_height}');
    connected.ws.send(encodeStdin("printf 'CROSS_SESSION_INPUT\\n'\r"));
    connected.ws.send(encodeResize(120, 50));

    await vi.waitFor(() => expect(connected.closed()?.code).toBe(1008));
    expect(tmux('capture-pane', '-p', '-t', '$0:@0')).not.toContain('CROSS_SESSION_INPUT');
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{pane_width}:#{pane_height}'))
      .toBe(approvedSize);
  });

  it('does not follow an exact window after that window is deleted', async () => {
    const connected = await connect();
    await vi.waitFor(() => expect(connected.output()).toContain('FIRST_WINDOW'));

    tmux('kill-window', '-t', '$0:@0');

    await vi.waitFor(() => expect(connected.closed()?.code).toBe(1008));
    expect(connected.output()).not.toContain('SECOND_WINDOW');
    expect(tmux('display-message', '-p', '-t', '$0:@1', '#{window_id}')).toBe('@1');
  });

  it('disconnects registration-backed terminals without killing external resources', async () => {
    const connected = await connect();
    await vi.waitFor(() => expect(connected.output()).toContain('FIRST_WINDOW'));
    const store = await import('@/lib/external-server-store');

    await expect(store.unregisterExternalServer(registrationId)).resolves.toBe(true);
    await vi.waitFor(() => expect(connected.closed()).toEqual({
      code: 1000,
      reason: 'External target unregistered',
    }));
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{window_id}')).toBe('@0');
  });
});
