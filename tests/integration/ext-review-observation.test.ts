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
let handlers: Promise<void>[];
const clients: WebSocket[] = [];
const realTmux = execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim();
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
  handlers = [];
  wss.on('connection', (ws, req) => { handlers.push(handleExtReviewObservation(ws, req)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  stopExtReviewObservations();
  clients.splice(0).forEach((ws) => ws.terminate());
  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
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
      expect(text(client.frames)).toContain('\x1b[8;30;90t');
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

  it.each([1, 3])('uses 15 commands per poll with %s concurrent viewers, including unchanged screens', async (viewers) => {
    const log = path.join(directory, 'poll-commands.jsonl');
    const bin = path.join(directory, 'count-bin');
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, 'tmux'), `#!${process.execPath}
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write(execFileSync(${JSON.stringify(realTmux)}, process.argv.slice(2)));
`, { mode: 0o700 });
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
    const originalCapture = await import('@/lib/ext-review-tmux');
    const capture = vi.spyOn(originalCapture, 'captureExtReviewWindow');
    const connected = await Promise.all(Array.from({ length: viewers }, () => connect()));
    await Promise.all(handlers);
    expect((await fs.readFile(log, 'utf8')).trim().split('\n')).toHaveLength(15 * viewers);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2 * viewers), { timeout: 3000 });
    // Wait for each second capture before the third poll can start.
    await Promise.all(capture.mock.results.slice(viewers).map((result) => result.value));
    connected.forEach((client) => client.ws.close());
    expect((await fs.readFile(log, 'utf8')).trim().split('\n')).toHaveLength(30 * viewers);
    connected.forEach((client) => expect(client.frames.filter((frame) => frame[0] === MSG_STDOUT)).toHaveLength(1));
  });

  it('rejects a snapshot when zoom visibility changes during capture', async () => {
    tmux('split-window', '-d', '-t', '$0:@0', 'sleep 300');
    const bin = path.join(directory, 'zoom-bin');
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, 'tmux'), `#!${process.execPath}
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const marker = ${JSON.stringify(path.join(directory, 'zoomed'))};
const args = process.argv.slice(2);
process.stdout.write(execFileSync(${JSON.stringify(realTmux)}, args));
if (args.includes('capture-pane') && !fs.existsSync(marker)) {
  fs.writeFileSync(marker, '');
  execFileSync(${JSON.stringify(realTmux)}, ['-S', ${JSON.stringify(socket)}, 'resize-pane', '-Z', '-t', '%0']);
}
`, { mode: 0o700 });
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
    const client = await connect();
    await vi.waitFor(() => expect(client.closed()?.code).toBe(1011), { timeout: 3000 });
    expect(text(client.frames)).toBe('');
  });

  it('still validates frozen targets while output is backpressured', async () => {
    const client = await connect();
    await Promise.all(handlers);
    const observer = [...wss.clients][0];
    vi.spyOn(observer, 'bufferedAmount', 'get').mockReturnValue(1024 * 1024);
    tmux('kill-window', '-t', '$0:@0');
    await vi.waitFor(() => expect(client.closed()?.code).toBe(1011));
    expect(client.frames.filter((frame) => frame[0] === MSG_STDOUT)).toHaveLength(1);
  });

  // Each command wrapper delegates to real tmux except at the chosen validation
  // step, where the observation-owned subprocess blocks until it is killed.
  const stages = [
    ['capture session check', 1], ['capture target inspection', 2],
    ['capture freeze', 3], ['pane listing', 7], ['pane capture', 8],
    ['post-capture resolution', 9], ['post-capture freeze', 11],
    ['consistency listing', 15],
  ] as const;
  it.each(stages.flatMap(([stage, command]) =>
    ['disconnect', 'delete', 'shutdown'].map((action) => ({ stage, command, action }))))(
    'cancels blocked $stage on $action without subsequent commands', async ({ command, action }) => {
      const log = path.join(directory, 'commands.jsonl');
      const bin = path.join(directory, 'bin');
      await fs.mkdir(bin);
      const executable = path.join(bin, 'tmux');
      await fs.writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const log = ${JSON.stringify(log)};
const count = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').length : 0;
fs.appendFileSync(log, JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }) + '\\n');
if (count + 1 === ${command}) {
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(execFileSync(${JSON.stringify(realTmux)}, process.argv.slice(2)));
}
`, { mode: 0o700 });
      vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);
      const client = await connect();
      let calls: { pid: number; args: string[] }[] = [];
      await vi.waitFor(async () => {
        calls = (await fs.readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
        expect(calls.length).toBe(command);
      }, { timeout: 3000 });
      const blockedPid = calls[command - 1].pid;
      expect(() => process.kill(blockedPid, 0)).not.toThrow();
      if (action === 'disconnect') client.ws.close();
      else if (action === 'delete') await store.deleteExtReview(reviewId);
      else stopExtReviewObservations();
      await vi.waitFor(() => {
        expect(extReviewObservers.size).toBe(0);
        expect(() => process.kill(blockedPid, 0)).toThrow();
      }, { timeout: 1000 });
      await Promise.all(handlers);
      expect((await fs.readFile(log, 'utf8')).trim().split('\n')).toHaveLength(command);
      expect(text(client.frames)).toBe('');
      vi.unstubAllEnvs();
      expect(tmux('has-session', '-t', '$0')).toBe('');
    });

  it('starts no commands when lookup, resolution, freezing or capture is already cancelled', async () => {
    const review = (await store.listExtReviews())[0];
    const { freezeExtReviewTargets, resolveExtReviewTargets, captureExtReviewWindow } = await import('@/lib/ext-review-tmux');
    const abort = new AbortController();
    abort.abort();
    const identityRead = vi.spyOn(fs, 'lstat');
    const definitionRead = vi.spyOn(fs, 'readFile');
    await expect(store.loadExtReviewDefinition(reviewId, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(store.getExtReview(reviewId, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(resolveExtReviewTargets(review, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(freezeExtReviewTargets({ socketPath: socket, session: '$0', windowTargets: ['@0'] }, abort.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    await expect(captureExtReviewWindow(review, '@0', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(identityRead).not.toHaveBeenCalled();
    expect(definitionRead).not.toHaveBeenCalled();
  });

  it('does not start a missing server', async () => {
    tmux('kill-server');
    const client = await connect();
    await vi.waitFor(() => expect(client.closed()?.code).toBe(1011));
    expect(text(client.frames)).toBe('');
    expect(() => tmux('-N', 'has-session', '-t', 'external')).toThrow();
  });
});
