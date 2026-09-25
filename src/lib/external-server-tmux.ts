import path from 'path';
import { nanoid } from 'nanoid';
import { ExternalTmuxSocketError, frozenExternalTmuxSocketIdentity } from '@/lib/external-tmux-socket';
import { execTmux, execTmuxBuffer, externalTmuxTarget, type TmuxTarget } from '@/lib/tmux-target';
import type {
  IExternalServer,
  IExternalServerInventory,
  ICreatedExternalTerminal,
  ICreateExternalTerminal,
  IExternalTmuxPane,
  IExternalTmuxSession,
  IExternalTmuxWindow,
  IRegisterExternalServer,
} from '@/types/external-server';

export class ExternalServerError extends Error {}

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
      const provenance = server.ownedTerminals?.find((candidate) => candidate.owner === 'purplemux'
        && candidate.resourceType === 'session' && candidate.sessionId === sessionId
        && candidate.sessionCreated === sessionCreated);
      session = { id: sessionId, name: '', sessionCreated, exists: true,
        attached: attached(sessionAttached), owned: Boolean(provenance),
        ...(provenance ? { provenance } : {}), windows: [] };
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

const validateExternalTerminalInput = (input: ICreateExternalTerminal): string => {
  if (!input || (input.name !== undefined && (typeof input.name !== 'string'
    || !input.name.trim() || /[:.\n\r\0]/.test(input.name)))) {
    throw new ExternalServerError('Terminal name must be non-empty and cannot contain colon or period');
  }
  return input.name?.trim() ?? `purplemux-${nanoid(8)}`;
};

/** Create one isolated session and return the exact identities needed for ownership persistence. */
export const createExternalTerminal = async (
  server: IExternalServer,
  input: ICreateExternalTerminal = {},
  signal?: AbortSignal,
): Promise<Omit<ICreatedExternalTerminal, 'provenance'>> => {
  const name = validateExternalTerminalInput(input);
  try {
    const { stdout } = await execTmux(externalServerTmuxTarget(server), [
      'new-session', '-d', '-P', '-F',
      '#{session_id}\t#{session_created}\t#{window_id}', '-s', name,
    ], { timeout: 5000, signal });
    const fields = stdout.trimEnd().split('\t');
    if (fields.length !== 3 || !/^\$\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])
      || !/^@\d+$/.test(fields[2])) {
      throw new ExternalServerError('Invalid external tmux terminal creation result');
    }
    await assertExternalServerSocketIdentity(server, signal);
    return { serverId: server.id, sessionId: fields[0], sessionCreated: fields[1],
      windowId: fields[2], name };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ExternalServerError) throw error;
    throw new ExternalServerError('Unable to create external tmux terminal');
  }
};

/** Compensate a failed ownership commit without ever targeting a replacement session. */
export const rollbackExternalTerminalCreation = async (
  server: IExternalServer,
  terminal: Pick<ICreatedExternalTerminal, 'sessionId' | 'sessionCreated'>,
  signal?: AbortSignal,
): Promise<void> => {
  if (!/^\$\d+$/.test(terminal.sessionId) || !/^\d+$/.test(terminal.sessionCreated)) {
    throw new ExternalServerError('Invalid external tmux terminal rollback identity');
  }
  const mismatch = 'purplemux-terminal-identity-mismatch';
  const identityMatches = `#{&&:#{==:#{session_id},${terminal.sessionId}},`
    + `#{==:#{session_created},${terminal.sessionCreated}}}`;
  const { stdout } = await execTmux(externalServerTmuxTarget(server), [
    'if-shell', '-F', '-t', terminal.sessionId, identityMatches,
    `kill-session -t ${terminal.sessionId}`,
    `display-message -p ${mismatch}`,
  ], { timeout: 5000, signal });
  if (stdout.trim() === mismatch) {
    throw new ExternalServerError('External tmux terminal changed before ownership rollback');
  }
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
    tasks.push(async () => { session.name = await readExternalTmuxField(backend,
      session.id, 'session_name', signal); });
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
