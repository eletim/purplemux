import { randomUUID } from 'crypto';
import type * as pty from 'node-pty';
import { buildShellEnv } from '@/lib/shell-env';
import { PRISTINE_ENV } from '@/lib/pristine-env';
import { execTmux, spawnTmuxPty, validateTmuxTarget, type TmuxTarget } from '@/lib/tmux-target';

export const EXTERNAL_TERMINAL_SESSION_OPTION = '@purplemux_internal_external_client';
const EXTERNAL_TERMINAL_SESSION_PREFIX = '__purplemux_external_client_';

const globalStore = globalThis as unknown as {
  __purplemux_external_terminal_sessions?: Map<string, Map<string, string>>;
};
const registeredSessions = globalStore.__purplemux_external_terminal_sessions ??= new Map();

export const registeredExternalTerminalSessionMarker = (
  socketPath: string,
  sessionId: string,
): string | undefined => registeredSessions.get(socketPath)?.get(sessionId);

/**
 * A private grouped session gives PurpleMux its own current-window state. The
 * session exists only while this control client is attached, so tmux cleans it
 * after disconnects and process crashes without PurpleMux killing any session.
 */
export class ExternalTerminalClientResource {
  private buffer = '';
  private unsafe = false;
  private stopped = false;
  private hasExited = false;
  private sequence = 0;
  private shadowSessionId = '';
  private windowCols = 0;
  private windowRows = 0;
  private active = false;
  private registered = false;
  private readonly ownedClientNames = new Set<string>();
  private readonly clientsSeenOutsideShadow = new Set<string>();
  private readonly exited: Promise<void>;
  private stopPromise: Promise<void> | null = null;
  private pending: { marker: string; resolve: (safe: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  private constructor(
    private readonly backend: TmuxTarget,
    private readonly client: pty.IPty,
    private readonly sourceSessionId: string,
    private readonly windowId: string,
    private readonly shadowSessionName: string,
    private readonly marker: string,
    private readonly onInvalid?: () => void,
  ) {
    this.client.onData((data) => this.receive(data));
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
    onInvalid?: () => void,
  ): Promise<ExternalTerminalClientResource> {
    const uuid = randomUUID();
    const marker = `v1:${uuid}`;
    const shadowName = `${EXTERNAL_TERMINAL_SESSION_PREFIX}${uuid.replaceAll('-', '')}`;
    // The random full name is unambiguous. tmux 3.2 cannot resolve its exact-match
    // '=' form inside the same command queue that creates the session.
    const shadowTarget = shadowName;
    let resource: ExternalTerminalClientResource | undefined;
    let client: pty.IPty | undefined;
    try {
      client = await spawnTmuxPty(backend, [
        '-u', '-C',
        'new-session', '-d', '-s', shadowName, '-t', sessionId,
        ';', 'set-option', '-t', shadowTarget, 'destroy-unattached', 'on',
        ';', 'set-option', '-t', shadowTarget, EXTERNAL_TERMINAL_SESSION_OPTION, marker,
        ';', 'set-option', '-t', shadowTarget, 'status', 'off',
        ';', 'select-window', '-t', `${shadowTarget}:${windowId}`,
        ';', 'attach-session', '-f', 'read-only,ignore-size,no-output',
        '-t', `${shadowTarget}:${windowId}`,
      ], {
        name: 'xterm-256color', cols: 80, rows: 24,
        cwd: PRISTINE_ENV.HOME || '/', env: buildShellEnv(),
      }, {
        signal,
        onSpawn: (spawned) => {
          resource = new ExternalTerminalClientResource(
            backend, spawned, sessionId, windowId, shadowName, marker, onInvalid,
          );
        },
      });
      await resource!.initialize(signal);
      return resource!;
    } catch (error) {
      try { client?.kill(); } catch { /* Client already exited. */ }
      resource?.unregister();
      // If setup stopped between new-session and attach-session, applying this
      // option to the still-unattached private session removes it without a kill.
      await execTmux(backend, [
        'set-option', '-t', `=${shadowName}`, 'destroy-unattached', 'on',
      ], { timeout: 5000 }).catch(() => {});
      throw error;
    }
  }

  get pid(): number { return this.client.pid; }
  get sessionTarget(): string { return `${this.shadowSessionId}:${this.windowId}`; }
  get cols(): number { return this.windowCols; }
  get rows(): number { return this.windowRows; }

  private async initialize(signal?: AbortSignal): Promise<void> {
    const { stdout } = await execTmux(this.backend, [
      'display-message', '-p', '-t', `=${this.shadowSessionName}:${this.windowId}`,
      `#{session_id}\t#{session_name}\t#{window_id}\t#{window_width}\t#{window_height}`
        + `\t#{${EXTERNAL_TERMINAL_SESSION_OPTION}}`,
    ], { timeout: 5000, signal });
    const [sessionId, sessionName, windowId, cols, rows, marker] = stdout.trimEnd().split('\t');
    if (!/^\$\d+$/.test(sessionId) || sessionName !== this.shadowSessionName
      || windowId !== this.windowId || !/^\d+$/.test(cols) || !/^\d+$/.test(rows)
      || Number(cols) < 1 || Number(rows) < 1 || marker !== this.marker) {
      throw new Error('External terminal client identity changed');
    }
    this.shadowSessionId = sessionId;
    this.windowCols = Number(cols);
    this.windowRows = Number(rows);
    this.register();
    this.drainProtocol();
    if (!await this.check([], signal)) throw new Error('External terminal client unavailable');
    this.active = true;
  }

  private fail(): void {
    const firstFailure = !this.unsafe;
    this.unsafe = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(false);
      this.pending = null;
    }
    if (firstFailure && this.active && !this.stopped) this.onInvalid?.();
  }

  private register(): void {
    if (this.backend.kind !== 'external') throw new Error('External terminal client requires an external backend');
    const sessions = registeredSessions.get(this.backend.socketPath) ?? new Map<string, string>();
    if (sessions.has(this.shadowSessionId)) throw new Error('External terminal client session is already registered');
    sessions.set(this.shadowSessionId, this.marker);
    registeredSessions.set(this.backend.socketPath, sessions);
    this.registered = true;
  }

  private unregister(): void {
    if (!this.registered || this.backend.kind !== 'external') return;
    const sessions = registeredSessions.get(this.backend.socketPath);
    if (sessions?.get(this.shadowSessionId) === this.marker) sessions.delete(this.shadowSessionId);
    if (sessions?.size === 0) registeredSessions.delete(this.backend.socketPath);
    this.registered = false;
  }

  private receive(data: string): void {
    this.buffer += data;
    if (this.buffer.length > 65536) return this.fail();
    this.drainProtocol();
  }

  private drainProtocol(): void {
    if (!this.shadowSessionId) return;
    let end: number;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      if (line.startsWith(`%session-window-changed ${this.shadowSessionId} `)
        && line !== `%session-window-changed ${this.shadowSessionId} ${this.windowId}`) this.fail();
      const clientSession = line.match(/^%client-session-changed (.+) (\$\d+) /);
      if (clientSession) {
        const [, clientName, sessionId] = clientSession;
        if (sessionId !== this.shadowSessionId) this.clientsSeenOutsideShadow.add(clientName);
        if (this.ownedClientNames.has(clientName) && sessionId !== this.shadowSessionId) this.fail();
      }
      const detachedClient = line.match(/^%client-detached (.+)$/)?.[1];
      if (detachedClient && this.ownedClientNames.has(detachedClient)) this.fail();
      if (line === `%window-close ${this.windowId}`
        || line === `%session-closed ${this.sourceSessionId}`
        || line === `%session-closed ${this.shadowSessionId}`) this.fail();
      if (line === this.pending?.marker) {
        const pending = this.pending;
        clearTimeout(pending.timer);
        this.pending = null;
        pending.resolve(!this.unsafe);
      }
    }
  }

  private inspectIdentity(signal?: AbortSignal): Promise<boolean> {
    return execTmux(this.backend, [
      'display-message', '-p', '-t', `${this.sourceSessionId}:${this.windowId}`,
      '#{session_id}\t#{session_group}\t#{window_id}',
      ';', 'display-message', '-p', '-t', `${this.shadowSessionId}:${this.windowId}`,
      `#{session_id}\t#{session_name}\t#{session_group}\t#{window_id}\t#{${EXTERNAL_TERMINAL_SESSION_OPTION}}`,
    ], { timeout: 5000, signal }).then(({ stdout }) => {
      const [source, shadow, extra] = stdout.trimEnd().split('\n');
      const [sourceId, sourceGroup, sourceWindow] = (source ?? '').split('\t');
      const [shadowId, shadowName, shadowGroup, shadowWindow, marker] = (shadow ?? '').split('\t');
      return extra === undefined && sourceId === this.sourceSessionId && sourceWindow === this.windowId
        && shadowId === this.shadowSessionId && shadowName === this.shadowSessionName
        && shadowWindow === this.windowId && marker === this.marker
        && !!sourceGroup && sourceGroup === shadowGroup;
    }).catch(() => false);
  }

  private clientsOnTarget(pids: number[], signal?: AbortSignal): Promise<boolean> {
    return execTmux(this.backend, ['list-clients', '-F',
      '#{client_pid}\t#{client_name}\t#{session_id}\t#{window_id}'], { timeout: 5000, signal }).then(async ({ stdout }) => {
      await validateTmuxTarget(this.backend, signal);
      const clients = new Map(stdout.trim().split('\n').map((line) => {
        const [pid, name, sessionId, windowId] = line.split('\t');
        return [pid, { name, sessionId, windowId }];
      }));
      return [this.pid, ...pids].every((pid) => {
        const client = clients.get(String(pid));
        if (!client || client.sessionId !== this.shadowSessionId || client.windowId !== this.windowId
          || this.clientsSeenOutsideShadow.has(client.name)) return false;
        this.ownedClientNames.add(client.name);
        return true;
      });
    }).catch(() => false);
  }

  check(pids: number[] = [], signal?: AbortSignal): Promise<boolean> {
    if (this.unsafe || this.stopped || this.pending || !this.shadowSessionId) return Promise.resolve(false);
    return Promise.all([
      this.inspectIdentity(signal),
      this.clientsOnTarget(pids, signal),
    ]).then(([identitySafe, clientsSafe]) => {
      if (!identitySafe || !clientsSafe || this.unsafe || this.stopped || this.pending) return false;
      const marker = `PMUX_EXTERNAL_CLIENT_${++this.sequence}`;
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => this.fail(), 5000);
        this.pending = { marker, resolve, timer };
        // This response follows all earlier selection notifications on the control connection.
        this.client.write(`display-message -p '${marker}'\n`);
      });
    });
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopped = true;
    this.fail();
    const detach = this.shadowSessionId
      ? execTmux(this.backend, ['detach-client', '-s', this.shadowSessionId], { timeout: 5000 }).then(() => {})
        .catch(() => {})
      : Promise.resolve();
    if (!this.hasExited) {
      try { this.client.kill(); } catch { /* Client already exited. */ }
    }
    this.stopPromise = Promise.all([this.exited, detach]).then(() => {}).finally(() => this.unregister());
    return this.stopPromise;
  }
}
