import path from 'path';
import { ExternalTmuxSocketError, frozenExternalTmuxSocketIdentity } from '@/lib/external-tmux-socket';
import { execTmux, externalTmuxTarget, type TmuxTarget } from '@/lib/tmux-target';
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

const INVENTORY_FORMAT = [
  '#{session_id}', '#{session_name}', '#{session_attached}',
  '#{window_id}', '#{window_name}', '#{window_index}', '#{window_active}',
  '#{pane_id}', '#{pane_index}', '#{pane_active}', '#{pane_pid}',
  '#{pane_current_command}', '#{pane_current_path}', '#{pane_dead}',
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
    if (fields.length !== 14) throw new ExternalServerError('Invalid external tmux runtime inventory');
    const [sessionId, sessionName, sessionAttached, windowId, windowName, windowIndex,
      windowActive, paneId, paneIndex, paneActive, panePid, currentCommand, currentPath, paneDead] = fields;
    if (!/^\$\d+$/.test(sessionId) || !/^@\d+$/.test(windowId) || !/^%\d+$/.test(paneId)) {
      throw new ExternalServerError('Invalid external tmux runtime inventory');
    }

    let session = sessions.get(sessionId);
    if (!session) {
      session = { id: sessionId, name: sessionName, exists: true, attached: attached(sessionAttached), windows: [] };
      sessions.set(sessionId, session);
    } else if (session.name !== sessionName || session.attached !== attached(sessionAttached)) {
      throw new ExternalServerError('External tmux runtime changed during discovery');
    }

    let window = session.windows.find((candidate) => candidate.id === windowId);
    if (!window) {
      window = { id: windowId, name: windowName, index: integer(windowIndex), exists: true,
        active: flag(windowActive), panes: [] };
      session.windows.push(window);
    } else if (window.name !== windowName || window.index !== integer(windowIndex)
      || window.active !== flag(windowActive)) {
      throw new ExternalServerError('External tmux runtime changed during discovery');
    }
    if (window.panes.some((pane) => pane.id === paneId)) {
      throw new ExternalServerError('Invalid external tmux runtime inventory');
    }
    window.panes.push({ id: paneId, index: integer(paneIndex), exists: true, active: flag(paneActive),
      pid: integer(panePid), currentCommand, currentPath, dead: flag(paneDead) });
  }
  return { ...server, exists: true, sessions: [...sessions.values()] };
};

/** Discover current resources only; this never persists targets or invokes a creating tmux command. */
export const discoverExternalServer = async (
  server: IExternalServer,
  signal?: AbortSignal,
): Promise<IExternalServerInventory> => {
  try {
    const { stdout } = await execTmux(externalServerTmuxTarget(server),
      ['list-panes', '-a', '-F', INVENTORY_FORMAT],
      { timeout: 5000, maxBuffer: 4 * 1024 * 1024, signal });
    await assertExternalServerSocketIdentity(server, signal);
    return parseExternalServerInventory(server, stdout);
  } catch (error) {
    signal?.throwIfAborted();
    return { ...server, exists: false, sessions: [], unavailableReason: error instanceof Error
      ? error.message : 'External tmux server is unavailable' };
  }
};
