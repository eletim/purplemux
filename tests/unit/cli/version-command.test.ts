import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');

describe('purplemux version command', () => {
  it.each(['--version', '-v'])('prints the package version for %s', (flag) => {
    const output = execFileSync(process.execPath, ['bin/purplemux.js', flag], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(output.trim()).toBe('0.4.6');
  });
});
