import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = path.resolve(process.cwd(), 'scripts/ensure-prompt-prefix.js');
const temporaryDirectories: string[] = [];

const createHome = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'purplemux-prompt-prefix-'));
  temporaryDirectories.push(directory);
  return directory;
};

const runScript = (home: string, input = '') => spawnSync(process.execPath, [script], {
  encoding: 'utf8',
  env: {
    ...process.env,
    HOME: home,
    ...(input ? { PURPLEMUX_FORCE_PROMPT: '1' } : {}),
  },
  input,
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('ensure-prompt-prefix', () => {
  it('offers the current user and hostname and persists the accepted prefix', () => {
    const home = createHome();
    const candidate = `${os.userInfo().username}@${os.hostname()}:`;
    const configDirectory = path.join(home, '.purplemux');
    fs.mkdirSync(configDirectory);
    fs.writeFileSync(path.join(configDirectory, 'config.json'), JSON.stringify({ locale: 'ja' }));

    const result = runScript(home, '\n');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Prompt prefix: ${candidate}\n`);
    expect(result.stdout).toContain('Use this prompt prefix? [Y/n] ');
    const configPath = path.join(home, '.purplemux', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.locale).toBe('ja');
    expect(config.promptPrefix).toBe(candidate);
    expect(config.updatedAt).toEqual(expect.any(String));
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
  });

  it('preserves existing config fields and skips future confirmation', () => {
    const home = createHome();
    const configDirectory = path.join(home, '.purplemux');
    const configPath = path.join(configDirectory, 'config.json');
    fs.mkdirSync(configDirectory);
    fs.writeFileSync(configPath, JSON.stringify({ locale: 'ja', promptPrefix: 'saved@host:' }));

    const result = runScript(home);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({
      locale: 'ja',
      promptPrefix: 'saved@host:',
    });
  });

  it('tolerates malformed config and persists the accepted prefix', () => {
    const home = createHome();
    const candidate = `${os.userInfo().username}@${os.hostname()}:`;
    const configDirectory = path.join(home, '.purplemux');
    const configPath = path.join(configDirectory, 'config.json');
    fs.mkdirSync(configDirectory);
    fs.writeFileSync(configPath, '{ invalid json');

    const result = runScript(home, '\n');

    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toMatchObject({
      promptPrefix: candidate,
      updatedAt: expect.any(String),
    });
  });

  it('persists a rejected candidate as a durable opt-out', () => {
    const home = createHome();

    const result = runScript(home, 'n\n');

    expect(result.status).toBe(0);
    const configPath = path.join(home, '.purplemux', 'config.json');
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toMatchObject({
      promptPrefix: '',
      updatedAt: expect.any(String),
    });
    expect(runScript(home).stdout).toBe('');
  });

  it('does not block startup when stdin closes before confirmation', () => {
    const home = createHome();

    const result = runScript(home);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(fs.existsSync(path.join(home, '.purplemux', 'config.json'))).toBe(false);
  });

  it('treats a saved empty prefix as configured', () => {
    const home = createHome();
    const configDirectory = path.join(home, '.purplemux');
    fs.mkdirSync(configDirectory);
    fs.writeFileSync(path.join(configDirectory, 'config.json'), JSON.stringify({ promptPrefix: '' }));

    const result = runScript(home);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
