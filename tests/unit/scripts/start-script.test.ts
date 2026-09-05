import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const temporaryDirectories: string[] = [];

const writeExecutable = (filePath: string, contents: string) => {
  fs.writeFileSync(filePath, contents, { mode: 0o755 });
};

interface RunOptions {
  cliVersion?: string;
  buildCheck?: 'fresh' | 'missing' | 'stale' | 'invalid';
  failCommand?: string;
}

const runStartScript = ({
  cliVersion,
  buildCheck = 'fresh',
  failCommand = '',
}: RunOptions = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'purplemux-start-test-'));
  temporaryDirectories.push(directory);
  const toolBinDirectory = path.join(directory, 'tool-bin');
  const globalBinDirectory = path.join(directory, 'bin');
  const logPath = path.join(directory, 'commands.log');
  fs.mkdirSync(toolBinDirectory);
  fs.mkdirSync(globalBinDirectory);

  writeExecutable(path.join(toolBinDirectory, 'node'), `#!/usr/bin/env bash
set -euo pipefail
if [[ \"\${1:-}\" == \"-p\" ]]; then
  printf '%s\\n' '0.4.6'
elif [[ \"\${1:-}\" == \"scripts/build-fingerprint.js\" && \"\${2:-}\" == \"check\" ]]; then
  [[ \"\${BUILD_CHECK:-fresh}\" == \"fresh\" ]]
else
  exit 64
fi
`);

  writeExecutable(path.join(toolBinDirectory, 'pnpm'), `#!/usr/bin/env bash
set -euo pipefail
printf 'pnpm' >> \"$COMMAND_LOG\"
printf ' %q' \"$@\" >> \"$COMMAND_LOG\"
printf '\\n' >> \"$COMMAND_LOG\"
if [[ \"\${FAIL_COMMAND:-}\" == \"\${1:-}\" ]]; then
  exit 1
fi
if [[ \"\${1:-}\" == \"config\" && \"\${2:-}\" == \"get\" && \"\${3:-}\" == \"global-bin-dir\" ]]; then
  printf '%s\\n' 'undefined'
elif [[ \"\${1:-}\" == \"add\" && \"\${2:-}\" == \"--global\" ]]; then
  cat > \"$GLOBAL_BIN/purplemux\" <<'CLI'
#!/usr/bin/env bash
printf '%s\\n' '0.4.6'
CLI
  chmod +x \"$GLOBAL_BIN/purplemux\"
fi
`);

  if (cliVersion !== undefined) {
    writeExecutable(path.join(toolBinDirectory, 'purplemux'), `#!/usr/bin/env bash
printf '%s\\n' '${cliVersion}'
`);
  }

  const result = spawnSync('/bin/bash', ['start.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      BUILD_CHECK: buildCheck,
      COMMAND_LOG: logPath,
      FAIL_COMMAND: failCommand,
      GLOBAL_BIN: globalBinDirectory,
      PATH: `${toolBinDirectory}:/usr/bin:/bin`,
      PNPM_HOME: directory,
    },
  });

  return {
    ...result,
    commands: fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '',
  };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('start.sh', () => {
  it('adds the configured global bin to PATH and installs a missing CLI', () => {
    const result = runStartScript();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Adding pnpm global bin to PATH for this launch:');
    expect(result.commands).toContain(`pnpm add --global ${root}\n`);
    expect(result.commands).toContain('pnpm start\n');
  });

  it('updates a mismatched CLI from the checkout', () => {
    const result = runStartScript({ cliVersion: '0.4.5' });

    expect(result.status).toBe(0);
    expect(result.commands).toContain(`pnpm add --global ${root}\n`);
    expect(result.stdout).toContain('Updating CLI from 0.4.5 to 0.4.6');
  });

  it('does not reinstall a matching CLI', () => {
    const result = runStartScript({ cliVersion: '0.4.6' });

    expect(result.status).toBe(0);
    expect(result.commands).not.toContain('pnpm add --global');
    expect(result.commands).toContain('pnpm start\n');
  });

  it.each(['missing', 'stale', 'invalid'] as const)(
    'builds when the shared fingerprint check reports a %s artifact',
    (buildCheck) => {
      const result = runStartScript({ cliVersion: '0.4.6', buildCheck });

      expect(result.status).toBe(0);
      expect(result.commands).toContain('pnpm build\n');
      expect(result.commands).toContain('pnpm start\n');
    },
  );

  it('does not rebuild when the shared fingerprint check accepts the artifact', () => {
    const result = runStartScript({ cliVersion: '0.4.6' });

    expect(result.status).toBe(0);
    expect(result.commands).not.toContain('pnpm build\n');
    expect(result.commands).toContain('pnpm start\n');
  });

  it.each(['add', 'build'])('stops when pnpm %s fails', (command) => {
    const result = runStartScript({
      cliVersion: command === 'add' ? undefined : '0.4.6',
      buildCheck: command === 'build' ? 'stale' : 'fresh',
      failCommand: command,
    });

    expect(result.status).not.toBe(0);
    expect(result.commands).not.toContain('pnpm start\n');
  });
});
