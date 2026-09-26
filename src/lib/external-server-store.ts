import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { nanoid } from 'nanoid';
import { createExternalTerminal as createTmuxExternalTerminal,
  createExternalSessionWindow as createTmuxExternalSessionWindow,
  freezeExternalServer, rollbackExternalTerminalCreation } from '@/lib/external-server-tmux';
import { stopExternalTerminals } from '@/lib/external-terminal-resources';
import type { ICreatedExternalTerminal, ICreatedExternalWindow, ICreateExternalTerminal,
  IExternalServer, IExternalTerminalProvenance, IExternalTmuxSession,
  IRegisterExternalServer } from '@/types/external-server';

const file = path.join(os.homedir(), '.purplemux', 'external-servers.json');
const state = globalThis as typeof globalThis & { __purplemuxExternalServerLock?: Promise<void> };

const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = state.__purplemuxExternalServerLock ?? Promise.resolve();
  let release!: () => void;
  state.__purplemuxExternalServerLock = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
};

const read = async (): Promise<IExternalServer[]> => {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(data)) throw new Error('Invalid external server registrations');
    return data.map((entry) => {
      const legacy = entry as IExternalServer & { ownedTerminals?: IExternalTerminalProvenance[] };
      const { ownedTerminals, ...server } = legacy;
      return {
        ...server,
        terminalCreations: server.terminalCreations ?? ownedTerminals ?? [],
      };
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

const write = async (servers: IExternalServer[]): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${nanoid()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(servers, null, 2), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
};

export const listExternalServers = (): Promise<IExternalServer[]> => withLock(read);

export const getExternalServer = (id: string): Promise<IExternalServer | undefined> =>
  withLock(async () => (await read()).find((server) => server.id === id));

export const registerExternalServer = (input: IRegisterExternalServer): Promise<IExternalServer> =>
  withLock(async () => {
    const frozen = await freezeExternalServer(input);
    const servers = await read();
    const server = { id: nanoid(), ...frozen, terminalCreations: [] };
    await write([...servers, server]);
    return server;
  });

export const createExternalSessionWindow = (
  serverId: string,
  session: Pick<IExternalTmuxSession, 'id' | 'sessionCreated'>,
): Promise<ICreatedExternalWindow | undefined> => withLock(async () => {
  const server = (await read()).find((candidate) => candidate.id === serverId);
  return server ? createTmuxExternalSessionWindow(server, session) : undefined;
});

export const createExternalTerminal = (
  serverId: string,
  input: ICreateExternalTerminal,
): Promise<ICreatedExternalTerminal | undefined> => withLock(async () => {
  const servers = await read();
  const index = servers.findIndex((server) => server.id === serverId);
  if (index < 0) return undefined;
  const prior = servers[index].terminalCreations?.find((entry) => entry.requestId === input.requestId);
  const identity = prior
    ? { ...prior, requestId: input.requestId }
    : { id: nanoid(), requestId: input.requestId, createdAt: new Date().toISOString() };
  const created = await createTmuxExternalTerminal(servers[index], input, identity);
  const { createdNow, ...terminal } = created;
  if (prior) return terminal;
  const provenance = created.provenance;
  servers[index] = {
    ...servers[index],
    terminalCreations: [...(servers[index].terminalCreations ?? []), provenance],
  };
  try {
    await write(servers);
  } catch (writeError) {
    if (!createdNow) throw writeError;
    try {
      await rollbackExternalTerminalCreation(servers[index], created);
    } catch (rollbackError) {
      throw new AggregateError([writeError, rollbackError],
        'Failed to persist terminal creation history and roll back the created external terminal');
    }
    throw writeError;
  }
  return terminal;
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
