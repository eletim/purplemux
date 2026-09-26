import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { nanoid } from 'nanoid';
import { createExternalSessionWindow as createTmuxExternalSessionWindow,
  freezeExternalServer } from '@/lib/external-server-tmux';
import { stopExternalTerminals } from '@/lib/external-terminal-resources';
import type { ICreatedExternalWindow, IExternalServer, IExternalTmuxSession,
  IRegisterExternalServer } from '@/types/external-server';

const directory = path.join(os.homedir(), '.purplemux');
const file = path.join(directory, 'external-servers.json');
const obsoleteMarkerKeyFile = path.join(directory, 'external-terminal-marker-key');
const state = globalThis as typeof globalThis & { __purplemuxExternalServerLock?: Promise<void> };

const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = state.__purplemuxExternalServerLock ?? Promise.resolve();
  let release!: () => void;
  state.__purplemuxExternalServerLock = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
};

const write = async (servers: IExternalServer[]): Promise<void> => {
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${file}.${nanoid()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(servers, null, 2), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
};

const removeObsoleteMarkerKey = async (): Promise<void> => {
  try {
    await fs.unlink(obsoleteMarkerKeyFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

const read = async (): Promise<IExternalServer[]> => {
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await removeObsoleteMarkerKey();
    return [];
  }
  if (!Array.isArray(data)) throw new Error('Invalid external server registrations');
  const servers = data.map((entry: IExternalServer) => ({
    id: entry.id,
    name: entry.name,
    socketPath: entry.socketPath,
    socketIdentity: entry.socketIdentity,
  }));
  const hasLegacyOwnershipData = data.some((entry) => entry && typeof entry === 'object'
    && ('ownedTerminals' in entry || 'terminalCreations' in entry));
  if (hasLegacyOwnershipData) await write(servers);
  await removeObsoleteMarkerKey();
  return servers;
};

export const listExternalServers = (): Promise<IExternalServer[]> => withLock(read);

export const getExternalServer = (id: string): Promise<IExternalServer | undefined> =>
  withLock(async () => (await read()).find((server) => server.id === id));

export const registerExternalServer = (input: IRegisterExternalServer): Promise<IExternalServer> =>
  withLock(async () => {
    const frozen = await freezeExternalServer(input);
    const servers = await read();
    const server = { id: nanoid(), ...frozen };
    await write([...servers, server]);
    return server;
  });

export const createExternalSessionWindow = (
  serverId: string,
  session: Pick<IExternalTmuxSession, 'id' | 'sessionCreated'> & { requestId: string },
): Promise<ICreatedExternalWindow | undefined> => withLock(async () => {
  const server = (await read()).find((candidate) => candidate.id === serverId);
  return server ? createTmuxExternalSessionWindow(server, session) : undefined;
});

/** Registration-only deletion: this function never invokes tmux. */
export const unregisterExternalServer = (id: string): Promise<boolean> => withLock(async () => {
  const servers = await read();
  const remaining = servers.filter((server) => server.id !== id);
  if (remaining.length === servers.length) return false;
  await write(remaining);
  stopExternalTerminals(`external-server:${id}`);
  return true;
});
