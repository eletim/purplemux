import path from 'path';
import { ExternalTmuxSocketError, frozenExternalTmuxSocketIdentity } from '@/lib/external-tmux-socket';
import { execTmux, execTmuxBuffer, externalTmuxTarget, type TmuxTarget } from '@/lib/tmux-target';
import type {
  IExternalServer,
  IExternalServerInventory,
  ICreatedExternalWindow,
  IExternalTmuxPane,
  IExternalTmuxSession,
  IExternalTmuxWindow,
  IRegisterExternalServer,
} from '@/types/external-server';

export class ExternalServerError extends Error {}
export class ExternalWindowOutcomeUnknownError extends ExternalServerError {
  constructor(public readonly requestId: string) {
    super('External tmux window creation outcome is unknown; retry with the same requestId');
  }
}

const windowCreationMarker = Symbol('externalWindowCreation');
type RuntimeWindow = IExternalTmuxWindow & { [windowCreationMarker]?: string };

export const validateExternalServerInput = (input: IRegisterExternalServer): void => {
  if (!input || typeof input.name !== 'string' || !input.name.trim()
    || /[\n\r\0]/.test(input.name) || typeof input.socketPath !== 'string'
    || !path.isAbsolute(input.socketPath)) {
    throw new ExternalServerError('Specify a display name and an absolute socketPath');
  }
};

export const assertExternalServerSocketIdentity = async (
  server: Pick<IExternalServer, 'socketPath' | 'socketIdentity'>,
  signal?: AbortSignal,
): Promise<void> => {
  try {
    if (await frozenExternalTmuxSocketIdentity(server.socketPath, signal) !== server.socketIdentity) {
      throw new ExternalServerError('External tmux server socket identity changed');
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ExternalServerError) throw error;
    throw new ExternalServerError(error instanceof ExternalTmuxSocketError
      ? error.message : 'External tmux server is unavailable');
  }
};

/** Every operation through this target rechecks the frozen socket identity. */
export const externalServerTmuxTarget = (
  server: Pick<IExternalServer, 'socketPath' | 'socketIdentity'>,
): TmuxTarget => externalTmuxTarget(server.socketPath, (signal) =>
  assertExternalServerSocketIdentity(server, signal));

/** Add an unowned window to one exact live session without creating or adopting a session. */
export const createExternalSessionWindow = async (
  server: IExternalServer,
  session: Pick<IExternalTmuxSession, 'id' | 'sessionCreated'> & { requestId: string },
  signal?: AbortSignal,
): Promise<ICreatedExternalWindow> => {
  if (!/^\$\d+$/.test(session.id) || !/^\d+$/.test(session.sessionCreated)
    || !/^[-_A-Za-z0-9]{1,128}$/.test(session.requestId)) {
    throw new ExternalServerError('Invalid external tmux session target');
  }
  const pendingWindowName = `purplemux-pending-${session.requestId}`;
  type FoundWindow = { created: ICreatedExternalWindow; marked: boolean; pending: boolean };
  const findCreatedWindow = (inventory: IExternalServerInventory): FoundWindow | null => {
    if (!inventory.exists) {
      throw new ExternalServerError(inventory.unavailableReason ?? 'External tmux server is unavailable');
    }
    const liveSession = inventory.sessions.find((candidate) => candidate.id === session.id);
    if (!liveSession || liveSession.sessionCreated !== session.sessionCreated) {
      throw new ExternalServerError('External tmux session identity changed');
    }
    const marked = liveSession.windows.find((candidate) =>
      (candidate as RuntimeWindow)[windowCreationMarker] === session.requestId);
    const pending = liveSession.windows.find((candidate) => candidate.name === pendingWindowName);
    const window = marked ?? pending;
    return window ? { marked: !!marked, pending: window.name === pendingWindowName,
      created: { serverId: server.id, sessionId: liveSession.id,
      sessionCreated: liveSession.sessionCreated, windowId: window.id,
      requestId: session.requestId } } : null;
  };
  const markCreatedWindow = async (created: ICreatedExternalWindow): Promise<ICreatedExternalWindow> => {
    await execTmux(externalServerTmuxTarget(server), [
      'set-option', '-w', '-t', `${created.sessionId}:${created.windowId}`,
      '@purplemux_tab_request_id', session.requestId,
      ';', 'set-option', '-wu', '-t', `${created.sessionId}:${created.windowId}`,
      'automatic-rename',
      ';', 'rename-window', '-t', `${created.sessionId}:${created.windowId}`,
      '#{pane_current_command}',
    ], { timeout: 5000, signal });
    await assertExternalServerSocketIdentity(server, signal);
    return created;
  };
  const finishCreatedWindow = (found: FoundWindow): Promise<ICreatedExternalWindow> =>
    found.marked && !found.pending ? Promise.resolve(found.created) : markCreatedWindow(found.created);
  const initial = await discoverExternalServer(server, signal);
  const prior = findCreatedWindow(initial);
  if (prior) {
    try {
      return await finishCreatedWindow(prior);
    } catch {
      signal?.throwIfAborted();
      throw new ExternalWindowOutcomeUnknownError(session.requestId);
    }
  }
  const reconcileCreatedWindow = async (): Promise<ICreatedExternalWindow> => {
    try {
      const recovered = findCreatedWindow(await discoverExternalServer(server, signal));
      if (recovered) return await finishCreatedWindow(recovered);
    } catch { /* The post-dispatch state is still ambiguous. */ }
    throw new ExternalWindowOutcomeUnknownError(session.requestId);
  };

  const mismatch = 'purplemux-session-identity-mismatch';
  const identityMatches = `#{&&:#{==:#{session_id},${session.id}},`
    + `#{==:#{session_created},${session.sessionCreated}}}`;
  const format = '#{session_id}\t#{session_created}\t#{window_id}';
  let stdout: string;
  try {
    ({ stdout } = await execTmux(externalServerTmuxTarget(server), [
      'if-shell', '-F', '-t', session.id, identityMatches,
      `new-window -d -P -F '${format}' -n ${pendingWindowName} -t ${session.id}`,
      `display-message -p ${mismatch}`,
    ], { timeout: 5000, signal }));
  } catch {
    signal?.throwIfAborted();
    return reconcileCreatedWindow();
  }
  const result = stdout.trimEnd();
  if (result === mismatch) {
    throw new ExternalServerError('External tmux session identity changed');
  }
  const fields = result.split('\t');
  if (fields.length !== 3 || fields[0] !== session.id || fields[1] !== session.sessionCreated
    || !/^@\d+$/.test(fields[2])) {
    return reconcileCreatedWindow();
  }
  const created = { serverId: server.id, sessionId: fields[0], sessionCreated: fields[1],
    windowId: fields[2], requestId: session.requestId };
  try {
    return await markCreatedWindow(created);
  } catch {
    signal?.throwIfAborted();
    return reconcileCreatedWindow();
  }
};

export const freezeExternalServer = async (
  input: IRegisterExternalServer,
  signal?: AbortSignal,
): Promise<Omit<IExternalServer, 'id'>> => {
  validateExternalServerInput(input);
  const name = input.name.trim();
  try {
    const socketIdentity = await frozenExternalTmuxSocketIdentity(input.socketPath, signal);
    const server = { name, socketPath: input.socketPath, socketIdentity };
    const result = await execTmux(externalServerTmuxTarget(server),
      ['display-message', '-p', '#{pid}'], { timeout: 5000, signal });
    if (!/^\d+$/.test(result.stdout.trim())) {
      throw new ExternalServerError('External tmux server is unavailable');
    }
    await assertExternalServerSocketIdentity(server, signal);
    return server;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ExternalServerError) throw error;
    throw new ExternalServerError(error instanceof ExternalTmuxSocketError
      ? error.message : 'External tmux server is unavailable');
  }
};

// Keep the enumerated fields ASCII-only so this works on tmux 2.9 and cannot be
// confused by delimiters in names or paths. Free-form fields are fetched below.
const INVENTORY_FORMAT = [
  '#{session_id}', '#{session_created}', '#{session_attached}', '#{window_id}', '#{window_index}',
  '#{window_active}', '#{pane_id}', '#{pane_index}', '#{pane_active}',
  '#{pane_pid}', '#{pane_dead}',
].join('\t');

const flag = (value: string): boolean => {
  if (value === '0') return false;
  if (value === '1') return true;
  throw new ExternalServerError('Invalid external tmux runtime inventory');
};

const integer = (value: string): number => {
  if (!/^\d+$/.test(value)) throw new ExternalServerError('Invalid external tmux runtime inventory');
  return Number(value);
};

const attached = (value: string): boolean => integer(value) > 0;

const parseExternalServerInventory = (server: IExternalServer, stdout: string): IExternalServerInventory => {
  const sessions = new Map<string, IExternalTmuxSession>();
  for (const line of stdout.trim() ? stdout.trimEnd().split('\n') : []) {
    const fields = line.split('\t');
    if (fields.length !== 11) throw new ExternalServerError('Invalid external tmux runtime inventory');
    const [sessionId, sessionCreated, sessionAttached, windowId, windowIndex, windowActive,
      paneId, paneIndex, paneActive, panePid, paneDead] = fields;
    if (!/^\$\d+$/.test(sessionId) || !/^\d+$/.test(sessionCreated)
      || !/^@\d+$/.test(windowId) || !/^%\d+$/.test(paneId)) {
      throw new ExternalServerError('Invalid external tmux runtime inventory');
    }

    let session = sessions.get(sessionId);
    if (!session) {
      session = { id: sessionId, name: '', sessionCreated, exists: true,
        attached: attached(sessionAttached), windows: [] };
      sessions.set(sessionId, session);
    } else if (session.sessionCreated !== sessionCreated || session.attached !== attached(sessionAttached)) {
      throw new ExternalServerError('External tmux runtime changed during discovery');
    }

    const linkIndex = integer(windowIndex);
    let window = session.windows.find((candidate) => candidate.index === linkIndex);
    if (!window) {
      window = { id: windowId, name: '', index: linkIndex, exists: true,
        active: flag(windowActive), panes: [] };
      session.windows.push(window);
    } else if (window.id !== windowId || window.active !== flag(windowActive)) {
      throw new ExternalServerError('External tmux runtime changed during discovery');
    }
    if (window.panes.some((pane) => pane.id === paneId)) {
      throw new ExternalServerError('Invalid external tmux runtime inventory');
    }
    window.panes.push({ id: paneId, index: integer(paneIndex), exists: true, active: flag(paneActive),
      pid: integer(panePid), currentCommand: '', currentPath: '', dead: flag(paneDead) });
  }
  return { ...server, exists: true, sessions: [...sessions.values()] };
};

const readExternalTmuxField = async (backend: TmuxTarget, target: string, field: string,
  signal?: AbortSignal): Promise<string> => {
  const { stdout } = await execTmuxBuffer(backend,
    ['display-message', '-p', '-t', target, `#{${field}}`], { timeout: 5000, signal });
  if (!stdout.length || stdout.at(-1) !== 0x0a) {
    throw new ExternalServerError('Invalid external tmux runtime inventory');
  }
  // Decode only after removing tmux's record newline. Invalid filename bytes are
  // represented by U+FFFD without corrupting boundaries for any other resource.
  return stdout.subarray(0, -1).toString('utf8');
};

const METADATA_CONCURRENCY = 8;

const runMetadataTasks = async (tasks: Array<() => Promise<void>>): Promise<void> => {
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed) {
      const index = next;
      next += 1;
      if (index >= tasks.length) return;
      try {
        await tasks[index]();
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(METADATA_CONCURRENCY, tasks.length) }, worker));
  if (failed) throw failure;
};

const populateExternalServerMetadata = async (inventory: IExternalServerInventory,
  signal?: AbortSignal): Promise<void> => {
  const backend = externalServerTmuxTarget(inventory);
  const tasks: Array<() => Promise<void>> = [];
  const windows = new Map<string, IExternalTmuxWindow[]>();
  const panes = new Map<string, IExternalTmuxPane[]>();
  for (const session of inventory.sessions) {
    tasks.push(async () => {
      session.name = await readExternalTmuxField(backend, session.id, 'session_name', signal);
    });
    for (const window of session.windows) {
      const links = windows.get(window.id) ?? [];
      links.push(window);
      windows.set(window.id, links);
      for (const pane of window.panes) {
        const appearances = panes.get(pane.id) ?? [];
        appearances.push(pane);
        panes.set(pane.id, appearances);
      }
    }
  }
  for (const [windowId, links] of windows) {
    tasks.push(async () => {
      const name = await readExternalTmuxField(backend, windowId, 'window_name', signal);
      links.forEach((window) => { window.name = name; });
    });
    tasks.push(async () => {
      const requestId = await readExternalTmuxField(
        backend, windowId, '@purplemux_tab_request_id', signal);
      if (!/^[-_A-Za-z0-9]{1,128}$/.test(requestId)) return;
      links.forEach((window) => {
        Object.defineProperty(window, windowCreationMarker, { value: requestId });
      });
    });
  }
  for (const [paneId, appearances] of panes) {
    tasks.push(async () => {
      const currentCommand = await readExternalTmuxField(backend, paneId, 'pane_current_command', signal);
      appearances.forEach((pane) => { pane.currentCommand = currentCommand; });
    });
    tasks.push(async () => {
      const currentPath = await readExternalTmuxField(backend, paneId, 'pane_current_path', signal);
      appearances.forEach((pane) => { pane.currentPath = currentPath; });
    });
  }
  await runMetadataTasks(tasks);
};

const isZeroSessionFailure = (error: unknown): boolean => error instanceof Error
  && /no current target|no sessions/.test(error.message);

const assertExternalServerLive = async (server: IExternalServer, signal?: AbortSignal): Promise<void> => {
  const { stdout } = await execTmux(externalServerTmuxTarget(server),
    ['display-message', '-p', '#{pid}'], { timeout: 5000, signal });
  if (!/^\d+\n?$/.test(stdout)) throw new ExternalServerError('External tmux server is unavailable');
  await assertExternalServerSocketIdentity(server, signal);
};

const unavailableInventory = (server: IExternalServer, error: unknown): IExternalServerInventory => ({
  ...server,
  exists: false,
  sessions: [],
  unavailableReason: error instanceof Error ? error.message : 'External tmux server is unavailable',
});

/** Discover current resources only; this never persists targets or invokes a creating tmux command. */
export const discoverExternalServer = async (
  server: IExternalServer,
  signal?: AbortSignal,
): Promise<IExternalServerInventory> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { stdout } = await execTmux(externalServerTmuxTarget(server),
        ['list-panes', '-a', '-F', INVENTORY_FORMAT],
        { timeout: 5000, maxBuffer: 4 * 1024 * 1024, signal });
      const inventory = parseExternalServerInventory(server, stdout);
      await populateExternalServerMetadata(inventory, signal);
      await assertExternalServerSocketIdentity(server, signal);
      return inventory;
    } catch (error) {
      signal?.throwIfAborted();
      if (isZeroSessionFailure(error)) {
        try {
          await assertExternalServerLive(server, signal);
          return { ...server, exists: true, sessions: [] };
        } catch (probeError) {
          signal?.throwIfAborted();
          return unavailableInventory(server, probeError);
        }
      }
      if (attempt === 0) {
        try {
          await assertExternalServerLive(server, signal);
          continue;
        } catch (probeError) {
          signal?.throwIfAborted();
          return unavailableInventory(server, probeError);
        }
      }
      return unavailableInventory(server, error);
    }
  }
  // The loop always returns, but keep the total return type explicit.
  return unavailableInventory(server, new ExternalServerError('External tmux server is unavailable'));
};

export const resolveExternalServerWindow = async (
  server: IExternalServer,
  sessionId: string,
  windowId: string,
  signal?: AbortSignal,
): Promise<TmuxTarget> => {
  if (!/^\$\d+$/.test(sessionId) || !/^@\d+$/.test(windowId)) {
    throw new ExternalServerError('Invalid external tmux window target');
  }
  const inventory = await discoverExternalServer(server, signal);
  if (!inventory.exists) {
    throw new ExternalServerError(inventory.unavailableReason ?? 'External tmux server is unavailable');
  }
  const session = inventory.sessions.find((candidate) => candidate.id === sessionId);
  if (!session?.windows.some((window) => window.id === windowId)) {
    throw new ExternalServerError('External tmux window is unavailable');
  }
  await assertExternalServerSocketIdentity(server, signal);
  return externalServerTmuxTarget(server);
};

export const captureExternalServerWindow = async (
  server: IExternalServer,
  sessionId: string,
  windowId: string,
  signal?: AbortSignal,
): Promise<string> => {
  const backend = await resolveExternalServerWindow(server, sessionId, windowId, signal);
  const { stdout } = await execTmux(backend, [
    'capture-pane', '-p', '-t', `${sessionId}:${windowId}`,
  ], { timeout: 5000, signal });
  await assertExternalServerSocketIdentity(server, signal);
  return stdout;
};
