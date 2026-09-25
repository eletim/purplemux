import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertExternalServerSocketIdentity, externalServerTmuxTarget } from '@/lib/external-server-tmux';
import { execTmux } from '@/lib/tmux-target';

let directory: string;
let socket: string;
const tmux = (...args: string[]) => execFileSync('tmux', ['-f', '/dev/null', '-S', socket, ...args],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-external-server-'));
  socket = path.join(directory, 'tmux');
  tmux('new-session', '-d', '-s', 'external', 'sleep 300');
});

afterEach(async () => {
  try { tmux('kill-server'); } catch {}
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('external tmux server registrations', () => {
  it('persists a stable server identity and unregisters without touching tmux', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    const server = await store.registerExternalServer({ name: '  dev server  ', socketPath: socket });
    expect(server).toMatchObject({ name: 'dev server', socketPath: socket });
    expect(server.id).toHaveLength(21);
    expect(server.socketIdentity).toMatch(/^\d+:\d+:\d+$/);
    expect(await store.listExternalServers()).toEqual([server]);

    tmux('new-window', '-d', '-t', 'external', 'sleep 300');
    expect(await store.unregisterExternalServer(server.id)).toBe(true);
    expect(await store.listExternalServers()).toEqual([]);
    expect(tmux('list-windows', '-t', 'external', '-F', '#{window_id}').split('\n')).toHaveLength(2);
  });

  it('rejects the managed socket and fails closed after socket replacement', async () => {
    vi.stubEnv('TMUX_TMPDIR', directory);
    const managedDirectory = path.join(directory, `tmux-${process.getuid?.()}`);
    await fs.mkdir(managedDirectory);
    await fs.link(socket, path.join(managedDirectory, 'purple'));
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/external-server-store');
    await expect(store.registerExternalServer({ name: 'managed', socketPath: socket }))
      .rejects.toThrow('not external');

    await fs.unlink(path.join(managedDirectory, 'purple'));
    const server = await store.registerExternalServer({ name: 'external', socketPath: socket });
    tmux('kill-server');
    tmux('new-session', '-d', '-s', 'replacement', 'sleep 300');
    await expect(assertExternalServerSocketIdentity(server)).rejects.toThrow('identity changed');
    await expect(execTmux(externalServerTmuxTarget(server), ['list-sessions']))
      .rejects.toThrow('identity changed');
  });
});
