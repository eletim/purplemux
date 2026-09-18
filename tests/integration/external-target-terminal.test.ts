import { createServer, type Server } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { sendExternalInput, areExternalClientsOnWindow } from '@/lib/external-target-terminal';
import type { IExtReview } from '@/types/ext-review';

const servers: Server[] = [];
const directories: string[] = [];

const listen = (socket: string): Promise<void> => new Promise((resolve, reject) => {
  const server = createServer();
  servers.push(server);
  server.once('error', reject);
  server.listen(socket, resolve);
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('external terminal socket identity', () => {
  it('rejects input and client checks after the registered socket path is replaced', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-external-socket-'));
    directories.push(directory);
    const socketPath = path.join(directory, 'tmux');
    await listen(socketPath);
    const original = await fs.lstat(socketPath, { bigint: true });
    const review: IExtReview = {
      id: 'registered', createdAt: new Date().toISOString(), interactive: true,
      socketPath, socketIdentity: `${original.dev}:${original.ino}`,
      serverPid: '1', sessionId: '$0', sessionCreated: '1', windowIds: ['@0'],
    };
    await fs.rename(socketPath, path.join(directory, 'old-tmux'));
    await listen(socketPath);
    const replacement = await fs.lstat(socketPath, { bigint: true });
    expect(replacement.ino).not.toBe(original.ino);

    await expect(sendExternalInput(review, '$0:@0', new TextEncoder().encode('secret'),
      new AbortController().signal)).rejects.toThrow('External review socket identity changed');
    await expect(areExternalClientsOnWindow(review, [123], '@0'))
      .rejects.toThrow('External review socket identity changed');
  });
});
