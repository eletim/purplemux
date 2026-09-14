import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '../../..');
const servers: Server[] = [];
const fixtureDirectories: string[] = [];

// Keep this list aligned with validate_purplemux in agent-workflow-manager/start.sh.
const awmRequiredHelpContracts = [
  'workspaces',
  'workspace create --cwd PATH',
  'workspace create response includes initialTab',
  'workspace delete -w WS --if-empty',
  'tab create -w WS [-n NAME] [-t TYPE]',
  'tab send -w WS TAB_ID',
  'tab interrupt -w WS TAB_ID',
  'tab status -w WS TAB_ID',
  'tab result -w WS TAB_ID',
  'tab capture -w WS TAB_ID',
  'tab close -w WS TAB_ID',
];

const createCliFixture = async (version: string): Promise<string> => {
  const fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-awm-compat-'));
  fixtureDirectories.push(fixtureDirectory);
  const fixtureBin = path.join(fixtureDirectory, 'bin');
  await fs.mkdir(fixtureBin);
  await Promise.all([
    fs.copyFile(path.join(root, 'bin', 'purplemux.js'), path.join(fixtureBin, 'purplemux.js')),
    fs.copyFile(path.join(root, 'bin', 'cli.js'), path.join(fixtureBin, 'cli.js')),
    fs.writeFile(
      path.join(fixtureDirectory, 'package.json'),
      JSON.stringify({ name: 'purplemux', version }),
    ),
  ]);
  return path.join(fixtureBin, 'purplemux.js');
};

const startWorkspaceServer = async (): Promise<number> => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ workspaces: [] }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  return address.port;
};

const validateWithAwmStartupContract = async (
  cliPath: string,
  env: NodeJS.ProcessEnv,
): Promise<void> => {
  const help = await execFileAsync(process.execPath, [cliPath, 'help'], { env, timeout: 5_000 });
  for (const contract of awmRequiredHelpContracts) {
    if (!help.stdout.includes(contract)) throw new Error(`Missing AWM help contract: ${contract}`);
  }

  const runtime = await execFileAsync(process.execPath, [cliPath, 'workspaces'], {
    env,
    timeout: 5_000,
  });
  const response = JSON.parse(runtime.stdout);
  if (!response || typeof response !== 'object' || !Array.isArray(response.workspaces)) {
    throw new Error('Invalid AWM workspace runtime contract');
  }
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(fixtureDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

describe('AWM startup compatibility', () => {
  it('accepts the updated CLI when it reports version 0.4.11', async () => {
    const cliPath = await createCliFixture('0.4.11');
    const port = await startWorkspaceServer();
    const env = {
      ...process.env,
      PMUX_PORT: String(port),
      PMUX_TOKEN: 'test-token',
      NO_UPDATE_NOTIFIER: '1',
    };

    const version = await execFileAsync(process.execPath, [cliPath, '--version'], { env });
    expect(version.stdout.trim()).toBe('0.4.11');
    await expect(validateWithAwmStartupContract(cliPath, env)).resolves.toBeUndefined();
  });
});
