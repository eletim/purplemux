import { execFile } from 'child_process';
import { createServer, type Server } from 'http';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(process.cwd(), 'bin/purplemux.js');
const servers: Server[] = [];
const run = (args: string[], port = 1) => execFileAsync(process.execPath, [cliPath, ...args], {
  env: { ...process.env, PMUX_PORT: String(port), PMUX_TOKEN: 'test-token' },
});
const startServer = async (status: number, body: unknown) => {
  const requests: unknown[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, token: req.headers['x-pmux-token'],
        body: raw ? JSON.parse(raw) : undefined });
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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe('purplemux external-server commands', () => {
  it('registers a named absolute socket and prints the server registration', async () => {
    const body = { id: 'server-1', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2' };
    const { port, requests } = await startServer(201, body);
    const result = await run(['external-server', 'register', '--socket', '/known/socket', '--name', 'dev'], port);
    expect(JSON.parse(result.stdout)).toEqual(body);
    expect(requests).toEqual([{ method: 'POST', url: '/api/cli/external-servers', token: 'test-token',
      body: { name: 'dev', socketPath: '/known/socket' } }]);
  });

  it('lists registrations and unregisters an encoded stable ID', async () => {
    let fixture = await startServer(200, { servers: [] });
    expect(JSON.parse((await run(['external-server', 'list'], fixture.port)).stdout)).toEqual({ servers: [] });
    expect(fixture.requests).toEqual([{ method: 'GET', url: '/api/cli/external-servers',
      token: 'test-token', body: undefined }]);

    fixture = await startServer(200, { deleted: true });
    const id = '-tbquP-K1QhHnU_ZqnRF1';
    expect(JSON.parse((await run(['external-server', 'unregister', id], fixture.port)).stdout))
      .toEqual({ deleted: true });
    expect(fixture.requests).toEqual([{ method: 'DELETE', url: `/api/cli/external-servers/${id}`,
      token: 'test-token', body: undefined }]);
  });

  it('creates a named terminal session on an encoded registration', async () => {
    const body = { serverId: '-tbquP-K1QhHnU_ZqnRF1', sessionId: '$2', windowId: '@3',
      provenance: { requestId: 'request-1' } };
    const { port, requests } = await startServer(201, body);
    expect(JSON.parse((await run(['external-server', 'create-terminal', body.serverId,
      '--name', 'work', '--request-id', 'request-1'], port)).stdout)).toEqual(body);
    expect(requests).toEqual([{ method: 'POST',
      url: `/api/cli/external-servers/${body.serverId}/terminals`, token: 'test-token',
      body: { requestId: 'request-1', name: 'work' } }]);
  });

  it('reports the reusable request ID when creation has an unknown server outcome', async () => {
    const fixture = await startServer(500, { error: 'storage timeout' });
    await expect(run(['external-server', 'create-terminal', 'server-1',
      '--request-id', 'retry-1'], fixture.port)).rejects.toMatchObject({
      code: 1,
      stderr: 'error: external terminal creation outcome unknown; retry with --request-id retry-1 '
        + '(server error: storage timeout)\n',
    });
  });

  it.each([
    [[], '--socket is required'],
    [['--socket', 'relative'], '--socket must be an absolute path'],
    [['--socket', '/known/socket'], '--name is required'],
    [['--socket', '--name', 'dev'], '--socket requires a value'],
    [['--name', 'one', '--name', 'two'], '--name may only be specified once'],
    [['--session', 'name'], 'unknown external-server register option: --session'],
  ])('rejects invalid register arguments %j before dispatch', async (args, error) => {
    await expect(run(['external-server', 'register', ...args])).rejects.toMatchObject({
      code: 1, stdout: '', stderr: `error: ${error}\n`,
    });
  });

  it('documents only the server-level registration contract', async () => {
    const { stdout } = await run(['help']);
    expect(stdout).toContain('external-server register --socket PATH --name NAME');
    expect(stdout).toContain('external-server list');
    expect(stdout).toContain('external-server create-terminal ID [--name NAME] [--request-id ID]');
    expect(stdout).toContain('external-server unregister ID');
    expect(stdout).not.toContain('external-target register');
  });
});
