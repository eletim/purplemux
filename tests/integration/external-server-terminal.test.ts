import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createServer, type Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import {
  encodeResize,
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
  wss.on('connection', (ws, request) => { void handleConnection(ws, request, null); });
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
  it('shares display, input, web input, resize, scrollback, reconnect, and switching behavior', async () => {
    const first = await connect();
    await vi.waitFor(() => expect(first.output()).toContain('FIRST_WINDOW'));

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
      "for n in {1..45}; do printf 'HISTORY_%03d\\n' \"$n\"; sleep 0.01; done\r",
    ));
    await vi.waitFor(() => expect(first.output()).toContain('HISTORY_045'));
    expect(first.output()).toContain('HISTORY_001');
    first.ws.close(1000);
    await vi.waitFor(() => expect(first.closed()?.code).toBe(1000));

    const resumed = await connect();
    await vi.waitFor(() => expect(resumed.output()).toContain('HISTORY_045'));
    resumed.ws.close(1000);
    await vi.waitFor(() => expect(resumed.closed()?.code).toBe(1000));

    const second = await connect('$0', '@1');
    await vi.waitFor(() => expect(second.output()).toContain('SECOND_WINDOW'));
    expect(second.output()).not.toContain('FIRST_WINDOW');
  }, 30_000);

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
