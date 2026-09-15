import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const awmStartScript = path.resolve(process.argv[2] ?? '');

if (!process.argv[2]) {
  throw new Error('Usage: node scripts/check-awm-compatibility.mjs PATH/TO/AWM/start.sh');
}
await fs.access(awmStartScript);

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-awm-compat-'));
const fixtureRoot = path.join(temporaryRoot, 'purplemux');
const fixtureBin = path.join(fixtureRoot, 'bin');
const toolBin = path.join(temporaryRoot, 'bin');
const home = path.join(temporaryRoot, 'home');
const callLog = path.join(temporaryRoot, 'calls.log');
const configPath = path.join(temporaryRoot, 'config.sh');

const writeExecutable = async (filePath, contents) => {
  await fs.writeFile(filePath, contents, { mode: 0o755 });
};

const run = (command, args, options) => new Promise((resolve) => {
  const child = spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ workspaces: [] }));
});

try {
  await Promise.all([
    fs.mkdir(fixtureBin, { recursive: true }),
    fs.mkdir(toolBin, { recursive: true }),
    fs.mkdir(home, { recursive: true }),
  ]);
  await Promise.all([
    fs.copyFile(path.join(root, 'bin', 'purplemux.js'), path.join(fixtureBin, 'purplemux.js')),
    fs.copyFile(path.join(root, 'bin', 'cli.js'), path.join(fixtureBin, 'cli.js')),
    fs.writeFile(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify({ name: 'purplemux', version: '0.4.11' }),
    ),
    writeExecutable(path.join(toolBin, 'uv'), `#!/usr/bin/env bash
set -euo pipefail
printf 'uv %s\\n' "$*" >>"$START_CALL_LOG"
if [[ \${1-} == sync ]]; then
  exit 0
fi
if [[ \${1-} == run && \${2-} == --no-sync && \${3-} == python ]]; then
  shift 3
  exec python3 "$@"
fi
if [[ \${1-} == run && \${2-} == python ]]; then
  exit 0
fi
exit 64
`),
    fs.writeFile(configPath, `AGENT_WORKFLOW_MANAGER_HOST=127.0.0.1
AGENT_WORKFLOW_MANAGER_HOST_ALIASES=
AGENT_WORKFLOW_MANAGER_PORT=8765
AGENT_WORKFLOW_MANAGER_NOTIFICATIONS=disabled
AGENT_WORKFLOW_MANAGER_NOTIFY_SUCCESS=true
AGENT_WORKFLOW_MANAGER_NOTIFY_FAILURE=true
AGENT_WORKFLOW_MANAGER_NOTIFY_STOPPED=false
NOTIFY_CONFIG=${path.join(home, 'notify.conf')}
`),
  ]);
  await fs.chmod(path.join(fixtureBin, 'purplemux.js'), 0o755);
  await fs.symlink(path.join(fixtureBin, 'purplemux.js'), path.join(toolBin, 'purplemux'));

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Runtime fixture did not bind');

  const environment = {
    ...process.env,
    HOME: home,
    PATH: `${toolBin}:${path.dirname(process.execPath)}:${process.env.PATH}`,
    START_CALL_LOG: callLog,
    AGENT_WORKFLOW_MANAGER_CONFIG_FILE: configPath,
    PMUX_PORT: String(address.port),
    PMUX_TOKEN: 'test-token',
    NO_UPDATE_NOTIFIER: '1',
  };
  const version = await execFileAsync(process.execPath, [path.join(fixtureBin, 'purplemux.js'), '--version'], {
    env: environment,
  });
  if (version.stdout.trim() !== '0.4.11') {
    throw new Error(`Fixture reported ${version.stdout.trim()}; expected 0.4.11`);
  }

  const result = await run('bash', [awmStartScript], {
    cwd: path.dirname(awmStartScript),
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`AWM startup validation failed (${result.status}):\n${result.stdout}${result.stderr}`);
  }
  const calls = await fs.readFile(callLog, 'utf8');
  if (!calls.includes('uv run --no-sync python -c')) {
    throw new Error('AWM did not run its PurpleMux runtime-response validator');
  }
  if (!calls.includes('uv run python -m purplemux_client.web')) {
    throw new Error('AWM did not proceed past PurpleMux startup validation');
  }

  console.log('AWM startup contract accepted the PurpleMux 0.4.11 fixture');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
