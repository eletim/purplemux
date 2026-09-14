import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');

describe('AWM compatibility for PurpleMux 0.4.11', () => {
  it('ships the workspace initial-tab contract when reporting version 0.4.11', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'purplemux-0.4.11-'));
    const fixtureBin = path.join(fixtureRoot, 'bin');

    try {
      fs.mkdirSync(fixtureBin);
      fs.copyFileSync(path.join(root, 'bin', 'purplemux.js'), path.join(fixtureBin, 'purplemux.js'));
      fs.copyFileSync(path.join(root, 'bin', 'cli.js'), path.join(fixtureBin, 'cli.js'));
      fs.writeFileSync(
        path.join(fixtureRoot, 'package.json'),
        JSON.stringify({ name: 'purplemux', version: '0.4.11' }),
      );

      const cliPath = path.join(fixtureBin, 'purplemux.js');
      const version = execFileSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' });
      const help = execFileSync(process.execPath, [cliPath, 'help'], { encoding: 'utf8' });

      expect(version.trim()).toBe('0.4.11');
      expect(help).toContain('workspace create response includes initialTab');
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
