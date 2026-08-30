import { execFile } from 'child_process';
import { createServer, type Server } from 'http';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(process.cwd(), 'bin/cli.js');

interface IRequest {
  method: string | undefined;
  url: string | undefined;
  token: string | undefined;
}

const servers: Server[] = [];

const startServer = async (
  status: number,
  body: Record<string, unknown>,
): Promise<{ port: number; requests: IRequest[] }> => {
  const requests: IRequest[] = [];
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
  // The CLI targets `localhost`, which may resolve to IPv4 or IPv6. Let Node
  // bind a dual-stack listener so the contract test follows the CLI hostname.
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

describe('purplemux tab close command', () => {
  it('preserves the successful request, output, and zero exit code', async () => {
    const { port, requests } = await startServer(200, { ok: true });

    const result = await execFileAsync(
      process.execPath,
      [cliPath, 'tab', 'close', '-w', 'ws-1', 'tab-1'],
      { env: { ...process.env, PMUX_PORT: String(port), PMUX_TOKEN: 'test-token' } },
    );

    expect(result.stdout).toBe('ok\n');
    expect(result.stderr).toBe('');
    expect(requests).toEqual([{
      method: 'DELETE',
      url: '/api/cli/tabs/tab-1?workspaceId=ws-1',
      token: 'test-token',
    }]);
  });

  it('preserves a non-zero exit and server error message on failure', async () => {
    const { port } = await startServer(404, { error: 'Tab not found' });

    await expect(execFileAsync(
      process.execPath,
      [cliPath, 'tab', 'close', '-w', 'ws-1', 'missing'],
      { env: { ...process.env, PMUX_PORT: String(port), PMUX_TOKEN: 'test-token' } },
    )).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'error: Tab not found\n',
    });
  });
});
