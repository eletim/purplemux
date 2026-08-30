import { execFile } from 'child_process';
import { createServer, type Server } from 'http';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(process.cwd(), 'bin/purplemux.js');
const servers: Server[] = [];

interface IRequest {
  method: string | undefined;
  url: string | undefined;
  token: string | undefined;
  body: unknown;
}

const startServer = async (
  status: number,
  body: unknown,
): Promise<{ port: number; requests: IRequest[] }> => {
  const requests: IRequest[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        token: req.headers['x-pmux-token'] as string | undefined,
        body: raw ? JSON.parse(raw) : undefined,
      });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
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

describe('purplemux workspace create command', () => {
  it('posts cwd and prints exactly one workspace JSON document', async () => {
    const workspace = {
      id: 'ws-created',
      name: 'Workspace 7',
      directories: ['/absolute/cwd'],
    };
    const { port, requests } = await startServer(201, workspace);

    const result = await execFileAsync(
      process.execPath,
      [cliPath, 'workspace', 'create', '--cwd', '/absolute/cwd'],
      { env: envFor(port) },
    );

    expect(result.stdout).toBe(`${JSON.stringify(workspace, null, 2)}\n`);
    expect(result.stderr).toBe('');
    expect(requests).toEqual([{
      method: 'POST',
      url: '/api/cli/workspaces',
      token: 'test-token',
      body: { cwd: '/absolute/cwd' },
    }]);
  });

  it('passes an optional name', async () => {
    const workspace = { id: 'ws-created', name: 'Named', directories: ['/absolute/cwd'] };
    const { port, requests } = await startServer(201, workspace);
    await execFileAsync(
      process.execPath,
      [cliPath, 'workspace', 'create', '--cwd', '/absolute/cwd', '--name', 'Named'],
      { env: envFor(port) },
    );
    expect(requests[0].body).toEqual({ cwd: '/absolute/cwd', name: 'Named' });
  });

  it('requires --cwd', async () => {
    await expect(execFileAsync(
      process.execPath,
      [cliPath, 'workspace', 'create'],
      { env: envFor(1) },
    )).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'error: --cwd is required\n',
    });
  });

  it('returns non-zero with server errors on stderr', async () => {
    const { port } = await startServer(400, { error: 'Directory does not exist' });
    await expect(execFileAsync(
      process.execPath,
      [cliPath, 'workspace', 'create', '--cwd', '/missing'],
      { env: envFor(port) },
    )).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'error: Directory does not exist\n',
    });
  });

  it('rejects a malformed success response', async () => {
    const { port } = await startServer(201, { ok: true });
    await expect(execFileAsync(
      process.execPath,
      [cliPath, 'workspace', 'create', '--cwd', '/absolute/cwd'],
      { env: envFor(port) },
    )).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'error: Invalid workspace response\n',
    });
  });

  it('documents workspace create in help output', async () => {
    const result = await execFileAsync(process.execPath, [cliPath, 'help']);
    expect(result.stdout).toContain('workspace create --cwd PATH [--name NAME]');
  });
});
