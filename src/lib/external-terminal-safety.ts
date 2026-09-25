import type * as pty from 'node-pty';
import { buildShellEnv } from '@/lib/shell-env';
import { PRISTINE_ENV } from '@/lib/pristine-env';
import { attachTmuxPty, execTmux, validateTmuxTarget, type TmuxTarget } from '@/lib/tmux-target';

export const captureExternalHistory = async (
  backend: TmuxTarget,
  target: string,
  historyLines: number,
  signal?: AbortSignal,
): Promise<string> => {
  const { stdout } = await execTmux(backend, [
    'capture-pane', '-p', '-e', '-S', `-${historyLines}`, '-E', '-1', '-t', target,
  ], { timeout: 5000, signal });
  await validateTmuxTarget(backend, signal);
  return stdout.replaceAll('\n', '\r\n');
};

export const sendExternalInput = async (backend: TmuxTarget, target: string, data: Uint8Array,
  signal: AbortSignal, webInput = false): Promise<void> => {
  if (webInput) {
    await execTmux(backend, ['copy-mode', '-q', '-t', target], { timeout: 5000, signal }).catch(async () => {
      // Missing copy mode is harmless, but a replaced external socket is not.
      await validateTmuxTarget(backend, signal);
    });
  }
  // -H sends bytes to the exact target pane, without feeding tmux client keys.
  for (let offset = 0; offset < data.length; offset += 1024) {
    const bytes = data.subarray(offset, offset + 1024);
    await execTmux(backend, ['send-keys', '-H', '-t', target,
      ...Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))], { timeout: 5000, signal });
    await validateTmuxTarget(backend, signal);
  }
};

export const areExternalClientsOnTarget = async (
  backend: TmuxTarget,
  pids: number[],
  sessionId: string,
  windowId: string,
  signal?: AbortSignal,
): Promise<boolean> => {
  const { stdout } = await execTmux(backend, ['list-clients', '-F',
    '#{client_pid}\t#{session_id}\t#{window_id}'], { timeout: 5000, signal });
  await validateTmuxTarget(backend, signal);
  const clients = new Set(stdout.trim().split('\n'));
  return pids.every((pid) => clients.has(`${pid}\t${sessionId}\t${windowId}`));
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

  private constructor(client: pty.IPty, private readonly windowId: string, sessionId: string) {
    this.client = client;
    this.client.onData((data) => this.receive(data, sessionId));
    this.exited = new Promise((resolve) => this.client.onExit(() => {
      this.hasExited = true;
      this.fail();
      resolve();
    }));
  }

  static async create(
    backend: TmuxTarget,
    sessionId: string,
    windowId: string,
    signal?: AbortSignal,
  ): Promise<ExternalWindowGuard> {
    let guard: ExternalWindowGuard | undefined;
    await attachTmuxPty(backend, `${sessionId}:${windowId}`, {
      name: 'xterm-256color', cols: 80, rows: 24,
      cwd: PRISTINE_ENV.HOME || '/', env: buildShellEnv(),
    }, {
      noOutput: true,
      signal,
      onSpawn: (client) => { guard = new ExternalWindowGuard(client, windowId, sessionId); },
    });
    return guard!;
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
