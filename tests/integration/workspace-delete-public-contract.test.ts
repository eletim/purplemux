import { execFile, spawn, type ChildProcess } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, 'bin', 'purplemux.js');
const tsxPath = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const children: ChildProcess[] = [];
const tempHomes: string[] = [];

const waitForServer = async (home: string): Promise<number> => {
  const portFile = path.join(home, '.purplemux', 'port');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const port = Number(await fs.readFile(portFile, 'utf8'));
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return port;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the integration server');
};

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  })));
  await Promise.all(tempHomes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

describe('real public workspace deletion contract', () => {
  it('runs the shipped CLI through the real Next API route and persistent store', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-public-delete-'));
    tempHomes.push(home);
    const base = path.join(home, '.purplemux');
    const emptyLayout = {
      root: { type: 'pane', id: 'pane-1', tabs: [], activeTabId: null },
      activePaneId: 'pane-1', updatedAt: '2026-09-05T00:00:00.000Z',
    };
    await fs.mkdir(path.join(base, 'workspaces', 'ws-target'), { recursive: true });
    await fs.mkdir(path.join(base, 'workspaces', 'ws-control'), { recursive: true });
    await fs.writeFile(path.join(base, 'workspaces.json'), JSON.stringify({
      workspaces: [
        { id: 'ws-target', name: 'Target', directories: [home] },
        { id: 'ws-control', name: 'Control', directories: [home] },
      ],
      groups: [], activeWorkspaceId: 'ws-target', sidebarCollapsed: false, sidebarWidth: 240,
      updatedAt: '2026-09-05T00:00:00.000Z',
    }));
    await fs.writeFile(path.join(base, 'workspaces', 'ws-target', 'layout.json'), JSON.stringify(emptyLayout));
    await fs.writeFile(path.join(base, 'workspaces', 'ws-control', 'layout.json'), JSON.stringify(emptyLayout));

    const server = spawn(tsxPath, ['server.ts'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        PORT: '0',
        HOST: 'localhost',
        NEXT_TELEMETRY_DISABLED: '1',
        NO_UPDATE_NOTIFIER: '1',
      },
      stdio: 'ignore',
    });
    children.push(server);
    const port = await waitForServer(home);
    const cliEnv = {
      ...process.env,
      HOME: home,
      PMUX_PORT: String(port),
      NO_UPDATE_NOTIFIER: '1',
    };

    const deleted = await execFileAsync(process.execPath, [
      cliPath, 'workspace', 'delete', '-w', 'ws-target', '--if-empty',
    ], { env: cliEnv });
    expect(JSON.parse(deleted.stdout)).toEqual({
      workspaceId: 'ws-target', status: 'deleted', deleted: true,
    });

    const absent = await execFileAsync(process.execPath, [
      cliPath, 'workspace', 'delete', '-w', 'ws-target', '--if-empty',
    ], { env: cliEnv });
    expect(JSON.parse(absent.stdout)).toEqual({
      workspaceId: 'ws-target', status: 'absent', deleted: false,
    });

    const stored = JSON.parse(await fs.readFile(path.join(base, 'workspaces.json'), 'utf8'));
    expect(stored.workspaces.map((workspace: { id: string }) => workspace.id)).toEqual(['ws-control']);
    await expect(fs.access(path.join(base, 'workspaces', 'ws-target'))).rejects.toThrow();
    await expect(fs.access(path.join(base, 'workspaces', 'ws-control', 'layout.json'))).resolves.toBeUndefined();
  }, 40_000);
});
