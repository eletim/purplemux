import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';

const root = path.resolve(__dirname, '../../..');

describe('version contract check', () => {
  it('accepts a development branch matching the package version', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/check-version.mjs', `dev/v${packageJson.version}`],
      { cwd: root, encoding: 'utf8' },
    );

    expect(output.trim()).toBe(`Version contract verified: ${packageJson.version}`);
  });

  it('accepts a recovery branch for the same development version', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/check-version.mjs', `dev/v${packageJson.version}-recovery`],
      { cwd: root, encoding: 'utf8' },
    );

    expect(output.trim()).toBe(`Version contract verified: ${packageJson.version}`);
  });

  it('accepts a numbered recovery branch for the same development version', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/check-version.mjs', `dev/v${packageJson.version}-recovery2`],
      { cwd: root, encoding: 'utf8' },
    );

    expect(output.trim()).toBe(`Version contract verified: ${packageJson.version}`);
  });

  it('rejects a development branch with a different package version', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/check-version.mjs', 'dev/v0.0.0'],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `dev/v0.0.0 requires package.json version 0.0.0; found ${packageJson.version}`,
    );
  });

  it('accepts the package-manager argument separator', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/check-version.mjs', '--', `dev/v${packageJson.version}`],
      { cwd: root, encoding: 'utf8' },
    );

    expect(output.trim()).toBe(`Version contract verified: ${packageJson.version}`);
  });
});
