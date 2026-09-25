import path from 'path';
import { ExternalTmuxSocketError, frozenExternalTmuxSocketIdentity } from '@/lib/external-tmux-socket';
import { execTmux, execTmuxBuffer, externalTmuxTarget, type TmuxTarget } from '@/lib/tmux-target';
import type {
  IExternalServer,
  IExternalServerInventory,
  IExternalTmuxSession,
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
  '#{session_id}', '#{session_attached}', '#{window_id}', '#{window_index}',
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
    if (fields.length !== 10) throw new ExternalServerError('Invalid external tmux runtime inventory');
    const [sessionId, sessionAttached, windowId, windowIndex, windowActive,
      paneId, paneIndex, paneActive, panePid, paneDead] = fields;
    if (!/^\$\d+$/.test(sessionId) || !/^@\d+$/.test(windowId) || !/^%\d+$/.test(paneId)) {
      throw new ExternalServerError('Invalid external tmux runtime inventory');
    }

    let session = sessions.get(sessionId);
    if (!session) {
      session = { id: sessionId, name: '', exists: true, attached: attached(sessionAttached), windows: [] };
      sessions.set(sessionId, session);
    } else if (session.attached !== attached(sessionAttached)) {
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

const populateExternalServerMetadata = async (inventory: IExternalServerInventory,
  signal?: AbortSignal): Promise<void> => {
  const backend = externalServerTmuxTarget(inventory);
  const windowNames = new Map<string, string>();
  const paneMetadata = new Map<string, { currentCommand: string; currentPath: string }>();
  for (const session of inventory.sessions) {
    session.name = await readExternalTmuxField(backend, session.id, 'session_name', signal);
    for (const window of session.windows) {
      let windowName = windowNames.get(window.id);
      if (windowName === undefined) {
        windowName = await readExternalTmuxField(backend, window.id, 'window_name', signal);
        windowNames.set(window.id, windowName);
      }
      window.name = windowName;
      for (const pane of window.panes) {
        let metadata = paneMetadata.get(pane.id);
        if (!metadata) {
          metadata = {
            currentCommand: await readExternalTmuxField(backend, pane.id, 'pane_current_command', signal),
            currentPath: await readExternalTmuxField(backend, pane.id, 'pane_current_path', signal),
          };
          paneMetadata.set(pane.id, metadata);
        }
        Object.assign(pane, metadata);
      }
    }
  }
};

const isZeroSessionFailure = (error: unknown): boolean => error instanceof Error
  && /no current target|no sessions/.test(error.message);

/** Discover current resources only; this never persists targets or invokes a creating tmux command. */
export const discoverExternalServer = async (
  server: IExternalServer,
  signal?: AbortSignal,
): Promise<IExternalServerInventory> => {
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
        const { stdout } = await execTmux(externalServerTmuxTarget(server),
          ['display-message', '-p', '#{pid}'], { timeout: 5000, signal });
        if (!/^\d+\n?$/.test(stdout)) throw new ExternalServerError('External tmux server is unavailable');
        await assertExternalServerSocketIdentity(server, signal);
        return { ...server, exists: true, sessions: [] };
      } catch (probeError) {
        signal?.throwIfAborted();
        return { ...server, exists: false, sessions: [], unavailableReason: probeError instanceof Error
          ? probeError.message : 'External tmux server is unavailable' };
      }
    }
    return { ...server, exists: false, sessions: [], unavailableReason: error instanceof Error
      ? error.message : 'External tmux server is unavailable' };
  }
};
