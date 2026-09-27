import fs from 'fs/promises';
import type { BigIntStats } from 'fs';
import path from 'path';

export class ExternalTmuxSocketError extends Error {}

const externalTmuxSocketStat = async (
  socketPath: string,
  signal?: AbortSignal,
): Promise<BigIntStats> => {
  signal?.throwIfAborted();
  const stat = await fs.lstat(socketPath, { bigint: true });
  signal?.throwIfAborted();
  if (!stat.isSocket()) throw new ExternalTmuxSocketError('socketPath must be a socket, not a symlink');

  const managedSocket = path.join(process.env.TMUX_TMPDIR || '/tmp', `tmux-${process.getuid?.()}`, 'purple');
  const managed = await fs.lstat(managedSocket, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  signal?.throwIfAborted();
  if (managed && stat.dev === managed.dev && stat.ino === managed.ino) {
    throw new ExternalTmuxSocketError('The purplemux-owned tmux socket is not external');
  }

  return stat;
};

/** Legacy Review identity. tmux permission changes make ctime unsuitable here. */
export const externalTmuxSocketIdentity = async (
  socketPath: string,
  signal?: AbortSignal,
): Promise<string> => {
  const stat = await externalTmuxSocketStat(socketPath, signal);
  return `${stat.dev}:${stat.ino}`;
};

/** Strong registration identity that also rejects fast inode reuse. */
export const frozenExternalTmuxSocketIdentity = async (
  socketPath: string,
  signal?: AbortSignal,
): Promise<string> => {
  const stat = await externalTmuxSocketStat(socketPath, signal);
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
};

/** Compatibility for Review definitions written before ctime was dropped. */
export const matchesExternalTmuxSocketIdentity = (stored: string, current: string): boolean =>
  stored === current || stored.startsWith(`${current}:`);
