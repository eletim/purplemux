import { execFile } from 'child_process';
import { createServer, type Server } from 'http';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(process.cwd(), 'bin/purplemux.js');
const servers: Server[] = [];

const startServer = async (status: number, body: unknown) => {
  const requests: Array<{ method?: string; url?: string; token?: string }> = [];
  const server = createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      token: req.headers['x-pmux-token'] as string | undefined,
    });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return { port: address.port, requests };
};

const envFor = (port: number) => ({
  ...process.env,
  PMUX_PORT: String(port),
  PMUX_TOKEN: 'test-token',
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('purplemux workspace delete command', () => {
  it.each([
    { workspaceId: 'ws-target', status: 'deleted', deleted: true },
    { workspaceId: 'ws-target', status: 'absent', deleted: false },
  ])('prints a successful API result as JSON: $status', async (body) => {
    const { port, requests } = await startServer(200, body);
    const result = await execFileAsync(
      process.execPath,
      [cliPath, 'workspace', 'delete', '-w', 'ws-target', '--if-empty'],
      { env: envFor(port) },
    );
    expect(result.stdout).toBe(`${JSON.stringify(body, null, 2)}\n`);
    expect(result.stderr).toBe('');
    expect(requests).toEqual([{
      method: 'DELETE',
      url: '/api/cli/workspaces/ws-target?ifEmpty=true',
      token: 'test-token',
    }]);
  });

  it('prints non-empty as JSON and exits 2', async () => {
    const body = {
      workspaceId: 'ws-target', status: 'not-empty', deleted: false, tabCount: 1, sessionCount: 1,
    };
    const { port } = await startServer(409, body);
    await expect(execFileAsync(
      process.execPath,
      [cliPath, 'workspace', 'delete', '-w', 'ws-target', '--if-empty'],
      { env: envFor(port) },
    )).rejects.toMatchObject({
      code: 2,
      stdout: `${JSON.stringify(body, null, 2)}\n`,
      stderr: '',
    });
  });

  it.each([
    [['workspace', 'delete', '--if-empty'], '--workspace is required'],
    [['workspace', 'delete', '-w', 'ws-target'], '--if-empty is required'],
  ])('validates required safety arguments %#', async (args, message) => {
    await expect(execFileAsync(process.execPath, [cliPath, ...args], {
      env: envFor(1),
    })).rejects.toMatchObject({ code: 1, stderr: `error: ${message}\n` });
  });

  it('documents the command in help', async () => {
    const result = await execFileAsync(process.execPath, [cliPath, 'help']);
    expect(result.stdout).toContain('workspace delete -w WS --if-empty');
  });
});
