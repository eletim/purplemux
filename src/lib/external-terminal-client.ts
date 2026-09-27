import { randomUUID } from 'crypto';
import type * as pty from 'node-pty';
import { buildShellEnv } from '@/lib/shell-env';
import { PRISTINE_ENV } from '@/lib/pristine-env';
import { execTmux, spawnTmuxPty, validateTmuxTarget, type TmuxTarget } from '@/lib/tmux-target';
import { bindExternalTerminalSession, EXTERNAL_TERMINAL_SESSION_OPTION,
  registerExternalTerminalSession, unregisterExternalTerminalSession,
  type IExternalTerminalSessionRegistration } from '@/lib/external-terminal-session-registry';

const EXTERNAL_TERMINAL_SESSION_PREFIX = '__purplemux_external_client_';

/**
 * A private session linked to one exact window gives PurpleMux isolated client
 * state. The session exists only while this control client is attached, so tmux
 * cleans it after disconnects and process crashes without killing the source.
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
  private readonly identityAbort = new AbortController();
  private identityWatchdog: Promise<void> | null = null;
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
    private readonly registration: IExternalTerminalSessionRegistration,
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
    socketIdentity: string,
    signal?: AbortSignal,
    onInvalid?: () => void,
  ): Promise<ExternalTerminalClientResource> {
    const uuid = randomUUID();
    const marker = `v1:${uuid}`;
    const shadowName = `${EXTERNAL_TERMINAL_SESSION_PREFIX}${uuid.replaceAll('-', '')}`;
    // The random full name is unambiguous. tmux 3.2 cannot resolve its exact-match
    // '=' form inside the same command queue that creates the session.
    const shadowTarget = shadowName;
    if (backend.kind !== 'external') throw new Error('External terminal client requires an external backend');
    const { stdout: sourceOutput } = await execTmux(backend, [
      'display-message', '-p', '-t', `${sessionId}:${windowId}`,
      '#{session_id}\t#{window_id}\t#{window_width}\t#{window_height}',
    ], { timeout: 5000, signal });
    const [sourceId, sourceWindowId, sourceCols, sourceRows] = sourceOutput.trimEnd().split('\t');
    if (sourceId !== sessionId || sourceWindowId !== windowId
      || !/^\d+$/.test(sourceCols) || !/^\d+$/.test(sourceRows)
      || Number(sourceCols) < 1 || Number(sourceRows) < 1) {
      throw new Error('External terminal source identity changed');
    }
    const registration = registerExternalTerminalSession({
      socketIdentity, sessionName: shadowName, marker,
    });
    let resource: ExternalTerminalClientResource | undefined;
    let client: pty.IPty | undefined;
    try {
      client = await spawnTmuxPty(backend, [
        '-u', '-C',
        'new-session', '-d', '-s', shadowName, '-x', sourceCols, '-y', sourceRows,
        ';', 'link-window', '-s', `${sessionId}:${windowId}`, '-t', `${shadowTarget}:1`,
        ';', 'kill-window', '-t', `${shadowTarget}:0`,
        ';', 'set-option', '-t', shadowTarget, 'destroy-unattached', 'on',
        ';', 'set-option', '-t', shadowTarget, EXTERNAL_TERMINAL_SESSION_OPTION, marker,
        ';', 'set-option', '-t', shadowTarget, 'status', 'off',
        ';', 'select-window', '-t', `${shadowTarget}:${windowId}`,
        ';', 'attach-session', '-f', 'read-only,no-output',
        '-t', `${shadowTarget}:${windowId}`,
      ], {
        name: 'xterm-256color', cols: Number(sourceCols), rows: Number(sourceRows),
        cwd: PRISTINE_ENV.HOME || '/', env: buildShellEnv(),
      }, {
        signal,
        onSpawn: (spawned) => {
          resource = new ExternalTerminalClientResource(
            backend, spawned, sessionId, windowId, shadowName, marker, registration, onInvalid,
          );
        },
      });
      await resource!.initialize(signal);
      return resource!;
    } catch (error) {
      try { client?.kill(); } catch { /* Client already exited. */ }
      await resource?.exited;
      const destroyed = await ExternalTerminalClientResource.sessionWasDestroyed(backend, shadowName);
      if (destroyed) unregisterExternalTerminalSession(registration);
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
    bindExternalTerminalSession(this.registration, sessionId);
    this.drainProtocol();
    if (!await this.check([], signal)) throw new Error('External terminal client unavailable');
    this.active = true;
    this.identityWatchdog = this.watchIdentity();
  }

  private fail(): void {
    const firstFailure = !this.unsafe;
    this.unsafe = true;
    this.identityAbort.abort();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(false);
      this.pending = null;
    }
    if (firstFailure && this.active && !this.stopped) this.onInvalid?.();
  }

  private static async sessionWasDestroyed(backend: TmuxTarget, sessionName: string): Promise<boolean> {
    try {
      await execTmux(backend, ['has-session', '-t', `=${sessionName}`], { timeout: 5000 });
      return false;
    } catch {
      try {
        await validateTmuxTarget(backend);
        return true;
      } catch {
        return false;
      }
    }
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
      '#{session_id}\t#{window_id}',
      ';', 'display-message', '-p', '-t', `${this.shadowSessionId}:${this.windowId}`,
      `#{session_id}\t#{session_name}\t#{window_id}\t#{${EXTERNAL_TERMINAL_SESSION_OPTION}}`,
    ], { timeout: 5000, signal }).then(({ stdout }) => {
      const [source, shadow, extra] = stdout.trimEnd().split('\n');
      const [sourceId, sourceWindow] = (source ?? '').split('\t');
      const [shadowId, shadowName, shadowWindow, marker] = (shadow ?? '').split('\t');
      return extra === undefined && sourceId === this.sourceSessionId && sourceWindow === this.windowId
        && shadowId === this.shadowSessionId && shadowName === this.shadowSessionName
        && shadowWindow === this.windowId && marker === this.marker;
    }).catch(() => false);
  }

  private waitForIdentityPoll(): Promise<boolean> {
    const signal = this.identityAbort.signal;
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve(true);
      }, 250);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async watchIdentity(): Promise<void> {
    const signal = this.identityAbort.signal;
    while (!this.stopped && !this.unsafe && await this.waitForIdentityPoll()) {
      const safe = await this.inspectIdentity(signal);
      if (signal.aborted || this.stopped || this.unsafe) return;
      if (!safe) {
        this.fail();
        return;
      }
    }
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
    this.identityAbort.abort();
    this.fail();
    const detach = this.shadowSessionId
      ? execTmux(this.backend, ['detach-client', '-s', this.shadowSessionId], { timeout: 5000 }).then(() => {})
        .catch(() => {})
      : Promise.resolve();
    if (!this.hasExited) {
      try { this.client.kill(); } catch { /* Client already exited. */ }
    }
    this.stopPromise = Promise.all([this.exited, detach, this.identityWatchdog]).then(async () => {
      if (await ExternalTerminalClientResource.sessionWasDestroyed(
        this.backend, this.shadowSessionName)) unregisterExternalTerminalSession(this.registration);
    });
    return this.stopPromise;
  }
}
