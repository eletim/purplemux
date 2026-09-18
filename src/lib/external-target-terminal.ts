import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import * as pty from 'node-pty';
import { assertExtReviewSocketIdentity, ExtReviewSnapshotRaceError, resolveExtReviewTargets } from '@/lib/ext-review-tmux';
import { exitCopyMode } from '@/lib/tmux';
import { buildShellEnv } from '@/lib/shell-env';
import { PRISTINE_ENV } from '@/lib/pristine-env';
import type { IExtReview } from '@/types/ext-review';

const execFile = promisify(execFileCallback);

/** Return only history not already sent when the bounded tmux capture slides. */
export const appendedExternalHistory = (previous: string, current: string): string => {
  if (!previous || !current) return current;

  // KMP prefix lengths find the longest suffix of previous matching the
  // prefix of current without repeatedly scanning a potentially large capture.
  const prefix = new Uint32Array(current.length);
  for (let i = 1, matched = 0; i < current.length; i++) {
    while (matched > 0 && current[i] !== current[matched]) matched = prefix[matched - 1];
    if (current[i] === current[matched]) matched++;
    prefix[i] = matched;
  }

  let matched = 0;
  for (let i = Math.max(0, previous.length - current.length); i < previous.length; i++) {
    while (matched > 0 && previous[i] !== current[matched]) matched = prefix[matched - 1];
    if (previous[i] === current[matched]) matched++;
  }
  return current.slice(matched);
};

/** Read bounded tmux history only when the registered window has one pane. */
export const captureExternalHistory = async (review: IExtReview, windowId: string,
  signal: AbortSignal): Promise<string | null> => {
  await resolveExtReviewTargets(review, signal);
  const target = `${review.sessionId}:${windowId}`;
  const list = async () => (await execFile('tmux', ['-N', '-S', review.socketPath, 'list-panes',
    '-t', target, '-F', '#{pane_id}\t#{window_id}'], { timeout: 5000, signal })).stdout.trim();
  const before = await list();
  const match = /^(%\d+)\t(@\d+)$/.exec(before);
  if (!match || match[2] !== windowId) return null;
  const { stdout } = await execFile('tmux', ['-N', '-S', review.socketPath, 'capture-pane',
    '-p', '-e', '-S', '-2000', '-E', '-1', '-t', `${target}.${match[1]}`],
  { timeout: 5000, maxBuffer: 4 * 1024 * 1024, signal });
  await resolveExtReviewTargets(review, signal);
  if (await list() !== before) throw new ExtReviewSnapshotRaceError('External pane changed during history capture');
  return stdout;
};

export const sendExternalInput = async (review: IExtReview, target: string, data: Uint8Array,
  signal: AbortSignal, webInput = false): Promise<void> => {
  if (webInput) {
    await assertExtReviewSocketIdentity(review, signal);
    await exitCopyMode(target, review.socketPath);
  }
  // -H sends bytes to the exact target pane, without feeding tmux client keys.
  for (let offset = 0; offset < data.length; offset += 1024) {
    await assertExtReviewSocketIdentity(review, signal);
    const bytes = data.subarray(offset, offset + 1024);
    await execFile('tmux', ['-N', '-S', review.socketPath, 'send-keys', '-H', '-t', target,
      ...Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))], { timeout: 5000, signal });
    await assertExtReviewSocketIdentity(review, signal);
  }
};

export const areExternalClientsOnWindow = async (review: IExtReview, pids: number[], windowId: string): Promise<boolean> => {
  await assertExtReviewSocketIdentity(review);
  const { stdout } = await execFile('tmux', ['-N', '-S', review.socketPath, 'list-clients', '-F',
    '#{client_pid}\t#{window_id}'], { timeout: 5000 });
  await assertExtReviewSocketIdentity(review);
  const clients = new Set(stdout.trim().split('\n'));
  return pids.every((pid) => clients.has(`${pid}\t${windowId}`));
};

/** A control client records window changes in tmux's own event order. */
export class ExternalWindowGuard {
  private readonly client: pty.IPty;
  private buffer = '';
  private unsafe = false;
  private stopped = false;
  private hasExited = false;
  private sequence = 0;
  private readonly exited: Promise<void>;
  private pending: { marker: string; resolve: (safe: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(review: IExtReview, private readonly windowId: string) {
    this.client = pty.spawn('tmux', ['-u', '-C', '-N', '-S', review.socketPath, 'attach-session',
      '-f', 'read-only,ignore-size,no-output', '-t', `${review.sessionId}:${windowId}`], {
      name: 'xterm-256color', cols: 80, rows: 24,
      cwd: PRISTINE_ENV.HOME || '/', env: buildShellEnv(),
    });
    this.client.onData((data) => this.receive(data, review.sessionId));
    this.exited = new Promise((resolve) => this.client.onExit(() => {
      this.hasExited = true;
      this.fail();
      resolve();
    }));
  }

  get pid(): number { return this.client.pid; }

  private fail(): void {
    this.unsafe = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(false);
      this.pending = null;
    }
  }

  private receive(data: string, sessionId: string): void {
    this.buffer += data;
    if (this.buffer.length > 65536) return this.fail();
    let end: number;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      if (line.startsWith('%session-window-changed ')
        && line !== `%session-window-changed ${sessionId} ${this.windowId}`) this.fail();
      if (line.startsWith('%window-close ') && line === `%window-close ${this.windowId}`) this.fail();
      if (line === this.pending?.marker) {
        const pending = this.pending;
        clearTimeout(pending.timer);
        this.pending = null;
        pending.resolve(!this.unsafe);
      }
    }
  }

  check(): Promise<boolean> {
    if (this.unsafe || this.stopped || this.pending) return Promise.resolve(false);
    const marker = `PMUX_WINDOW_GUARD_${++this.sequence}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.fail(), 5000);
      this.pending = { marker, resolve, timer };
      // The marker response follows all earlier window-change notifications
      // on this control connection, including an away-and-back switch.
      this.client.write(`display-message -p '${marker}'\n`);
    });
  }

  stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true;
      this.fail();
      if (!this.hasExited) {
        try { this.client.kill(); } catch { /* Client already exited. */ }
      }
    }
    return this.exited;
  }
}
