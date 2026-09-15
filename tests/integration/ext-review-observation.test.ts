import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createServer, type Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { stopExtReviewObservations, extReviewObservers } from '@/lib/ext-review-observation-resources';
import { MSG_STDOUT, MSG_HEARTBEAT, encodeStdin, encodeWebStdin, encodeResize, encodeKillSession } from '@/lib/terminal-protocol';

let directory: string;
let socket: string;
let server: Server;
let wss: WebSocketServer;
let origin: string;
let store: typeof import('@/lib/ext-review-store');
let reviewId: string;
const clients: WebSocket[] = [];
const tmux = (...args: string[]) => execFileSync('tmux', ['-f', '/dev/null', '-S', socket, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const terminalState = () => tmux('list-panes', '-a', '-F',
  '#{session_id}:#{session_name}:#{window_id}:#{window_name}:#{pane_id}:#{pane_width}:#{pane_height}:#{pane_pid}');
const connect = async (query = `reviewId=${reviewId}&windowId=%40${0}`) => {
  const ws = new WebSocket(`${origin}/api/ext-review-terminal?${query}`);
  clients.push(ws);
  const frames: Buffer[] = [];
  let closed: { code: number; reason: string } | undefined;
  ws.on('message', (data) => frames.push(Buffer.from(data as Buffer)));
  ws.on('close', (code, reason) => { closed = { code, reason: reason.toString() }; });
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return { ws, frames, closed: () => closed };
};
const text = (frames: Buffer[]) => frames.filter((frame) => frame[0] === MSG_STDOUT)
  .map((frame) => frame.subarray(1).toString()).join('');

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-observe-'));
  socket = path.join(directory, 'tmux');
  tmux('new-session', '-d', '-s', 'external', '-n', 'approved', '-x', '90', '-y', '30', 'sleep 300');
  tmux('new-window', '-d', '-t', 'external', '-n', 'hidden', 'echo UNAPPROVED_SECRET; sleep 300');
  vi.spyOn(os, 'homedir').mockReturnValue(directory);
  vi.resetModules();
  store = await import('@/lib/ext-review-store');
  const review = await store.createExtReview({ socketPath: socket, session: 'external', windowTargets: ['@0'] });
  reviewId = review.id;
  const { handleExtReviewObservation } = await import('@/lib/ext-review-observation');
  server = createServer();
  wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => { void handleExtReviewObservation(ws, req); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  stopExtReviewObservations();
  clients.splice(0).forEach((ws) => ws.terminate());
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { tmux('kill-server'); } catch {}
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('read-only external review observation with real tmux and WebSockets', () => {
  it('renders live approved panes without attaching or exposing added windows', async () => {
    tmux('respawn-pane', '-k', '-t', '$0:@0', 'echo APPROVED_FIRST; sleep 300');
    tmux('split-window', '-d', '-t', '$0:@0', 'echo APPROVED_SPLIT; sleep 300');
    const state = terminalState();
    const client = await connect();
    await vi.waitFor(() => {
      expect(text(client.frames)).toContain('APPROVED_FIRST');
      expect(text(client.frames)).toContain('APPROVED_SPLIT');
    });
    expect(text(client.frames)).not.toContain('UNAPPROVED_SECRET');
    expect(tmux('list-clients')).toBe('');
    expect(terminalState()).toBe(state);
    tmux('new-window', '-d', '-t', 'external', '-n', 'added', 'echo ADDED_SECRET; sleep 300');
    tmux('respawn-pane', '-k', '-t', '$0:@0.%0', 'echo APPROVED_UPDATED; sleep 300');
    await vi.waitFor(() => expect(text(client.frames)).toContain('APPROVED_UPDATED'));
    expect(text(client.frames)).not.toContain('ADDED_SECRET');
    client.ws.send(Buffer.from([MSG_HEARTBEAT]));
    await vi.waitFor(() => expect(client.frames.some((frame) => frame.equals(Buffer.from([MSG_HEARTBEAT])))).toBe(true));
    const after = terminalState();
    client.ws.close();
    await vi.waitFor(() => expect(extReviewObservers.size).toBe(0));
    expect(terminalState()).toBe(after);
  });

  it.each([
    ['stdin', encodeStdin('touch forbidden\r')], ['web input', encodeWebStdin('exit\r')],
    ['resize', encodeResize(10, 5)], ['kill', encodeKillSession()],
    ['send-keys', JSON.stringify({ type: 'send-keys', keys: 'exit' })],
    ['rename', JSON.stringify({ type: 'rename', name: 'other' })],
    ['target override', JSON.stringify({ windowId: '@1' })],
    ['unknown opcode', Buffer.from([255])], ['empty message', Buffer.alloc(0)],
    ['malformed heartbeat', Buffer.from([MSG_HEARTBEAT, 0])],
  ])('rejects %s without changing external state', async (_name, message) => {
    const state = terminalState();
    const client = await connect();
    client.ws.send(message);
    await vi.waitFor(() => expect(client.closed()?.code).toBe(1008));
    expect(terminalState()).toBe(state);
    expect(tmux('list-clients')).toBe('');
    expect(extReviewObservers.size).toBe(0);
  });

  it.each(['windowId=%401', 'windowId=%40999', 'windowId=%400&session=external',
    'windowId=%400&socketPath=/tmp/other', 'windowId=%400&cols=10&rows=5',
    'windowId=%400&windowId=%401', 'windowId=%400&kill=true', ''])('rejects unapproved or overridden targets: %s', async (query) => {
    const state = terminalState();
    const client = await connect(`reviewId=${reviewId}&${query}`);
    await vi.waitFor(() => expect(client.closed()?.code).toBe(1008));
    expect(text(client.frames)).toBe('');
    expect(terminalState()).toBe(state);
  });

  it.each(['delete', 'shutdown'])('releases only observation resources on %s', async (action) => {
    const state = terminalState();
    const client = await connect();
    await vi.waitFor(() => expect(client.frames.length).toBeGreaterThan(0));
    if (action === 'delete') await store.deleteExtReview(reviewId);
    else stopExtReviewObservations();
    await vi.waitFor(() => expect(client.closed()?.code).toBe(action === 'delete' ? 1000 : 1001));
    expect(extReviewObservers.size).toBe(0);
    expect(terminalState()).toBe(state);
    expect(tmux('list-clients')).toBe('');
  });

  it('ends observation when a frozen window disappears without following its replacement', async () => {
    const client = await connect();
    await vi.waitFor(() => expect(client.frames.length).toBeGreaterThan(0));
    tmux('kill-window', '-t', '$0:@0');
    tmux('new-window', '-d', '-t', 'external:0', '-n', 'replacement', 'echo REPLACEMENT_SECRET; sleep 300');
    await vi.waitFor(() => expect(client.closed()?.code).toBe(1011));
    expect(text(client.frames)).not.toContain('REPLACEMENT_SECRET');
    expect(tmux('list-windows', '-t', '$0', '-F', '#{window_id}')).not.toContain('@0');
    expect(extReviewObservers.size).toBe(0);
  });

  it('does not start a missing server', async () => {
    tmux('kill-server');
    const client = await connect();
    await vi.waitFor(() => expect(client.closed()?.code).toBe(1011));
    expect(text(client.frames)).toBe('');
    expect(() => tmux('-N', 'has-session', '-t', 'external')).toThrow();
  });
});
