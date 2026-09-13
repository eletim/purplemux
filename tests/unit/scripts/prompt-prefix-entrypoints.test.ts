import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('prompt-prefix startup entry points', () => {
  it('runs setup before both documented package-script launches', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));

    expect(packageJson.scripts.predev).toBe('node scripts/ensure-prompt-prefix.js');
    expect(packageJson.scripts.prestart).toBe('node scripts/ensure-prompt-prefix.js');
  });
});
