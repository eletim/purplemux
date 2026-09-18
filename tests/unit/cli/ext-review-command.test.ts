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

const createArgs = ['ext-review', 'create', '--socket', '/known/socket', '--session', '$2',
  '--window', '@1', '--window', '@3'];

describe('purplemux ext-review commands', () => {
  it('routes creation to the lifecycle API with only explicit targets and prints id and browser URL', async () => {
    const review = { id: 'review-1', url: '/ext-review/review-1', windowIds: ['@1', '@3'] };
    const { port, requests } = await startServer(201, review);
    const result = await run(createArgs, port);
    expect(JSON.parse(result.stdout)).toEqual({ ...review, url: `http://localhost:${port}/ext-review/review-1` });
    expect(result.stderr).toBe('');
    expect(requests).toEqual([{ method: 'POST', url: '/api/cli/ext-reviews', token: 'test-token',
      body: { socketPath: '/known/socket', session: '$2', windowTargets: ['@1', '@3'] } }]);
  });

  it.each([['get', 'GET', { id: 'review/1' }], ['delete', 'DELETE', { deleted: true }]])(
    'routes %s to the encoded lifecycle endpoint and prints JSON', async (command, method, body) => {
      const { port, requests } = await startServer(200, body);
      const result = await run(['ext-review', command as string, 'review/1'], port);
      expect(JSON.parse(result.stdout)).toEqual(body);
      expect(requests).toEqual([{ method, url: '/api/cli/ext-reviews/review%2F1', token: 'test-token', body: undefined }]);
    },
  );

  it.each([['open', 'GET'], ['unregister', 'DELETE']])(
    'accepts a generated external target ID beginning with a dash for %s', async (command, method) => {
      const id = '-tbquP-K1QhHnU_ZqnRF1';
      const body = command === 'open' ? { id, interactive: true } : { deleted: true };
      const { port, requests } = await startServer(200, body);
      const result = await run(['external-target', command, id], port);
      expect(JSON.parse(result.stdout)).toMatchObject(body);
      expect(requests).toEqual([{ method, url: `/api/cli/ext-reviews/${id}`, token: 'test-token', body: undefined }]);
    },
  );

  it.each([
    [[], '--socket is required'],
    [['--socket', 'relative'], '--socket must be an absolute path'],
    [['--socket', '/known/socket'], '--session is required'],
    [['--socket', '/known/socket', '--session', 'name'], '--window is required (repeat for each target)'],
    [['--socket', '--session', 'name'], '--socket requires a value'],
    [['--socket', '/one', '--socket', '/two'], '--socket may only be specified once'],
    [['--workspace', 'ws-1'], 'unknown ext-review create option: --workspace'],
  ])('rejects incomplete or unsupported selectors %j before dispatch', async (args, error) => {
    await expect(run(['ext-review', 'create', ...args])).rejects.toMatchObject({
      code: 1, stdout: '', stderr: `error: ${error}\n`,
    });
  });

  it.each(['get', 'delete'])('requires exactly one ID for %s', async (command) => {
    for (const args of [[], ['id', 'extra'], ['--workspace', 'ws-1']]) {
      await expect(run(['ext-review', command, ...args])).rejects.toMatchObject({
        code: 1, stdout: '', stderr: 'error: exactly one Review ID is required\n',
      });
    }
  });

  it.each([['create', 400], ['get', 409], ['delete', 404]])('reports API errors for %s', async (command, status) => {
    const { port } = await startServer(status as number, { error: 'Review unavailable' });
    const args = command === 'create' ? createArgs : ['ext-review', command as string, 'review-1'];
    await expect(run(args, port)).rejects.toMatchObject({ code: 1, stdout: '', stderr: 'error: Review unavailable\n' });
  });

  it('rejects creation responses missing the required output fields', async () => {
    const { port } = await startServer(201, { id: 'review-1' });
    await expect(run(createArgs, port)).rejects.toMatchObject({
      code: 1, stdout: '', stderr: 'error: invalid review creation response: expected id and url\n',
    });
  });

  it.each(['list', 'discover', 'send', 'update'])('does not offer %s commands', async (command) => {
    await expect(run(['ext-review', command])).rejects.toMatchObject({ code: 1, stdout: '',
      stderr: `error: unknown ext-review command: ${command}. Run 'purplemux help' for usage.\n` });
  });

  it('documents all three commands in help', async () => {
    const { stdout } = await run(['help']);
    expect(stdout).toContain('ext-review create --socket PATH --session SESSION --window @ID [--window @ID ...]');
    expect(stdout).toContain('ext-review get ID');
    expect(stdout).toContain('ext-review delete ID');
    expect(stdout).toContain('JSON with id and browser url');
  });
});
