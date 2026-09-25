import path from 'path';
import { ExternalTmuxSocketError, frozenExternalTmuxSocketIdentity } from '@/lib/external-tmux-socket';
import { execTmux, externalTmuxTarget, type TmuxTarget } from '@/lib/tmux-target';
import type { IExternalServer, IRegisterExternalServer } from '@/types/external-server';

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
