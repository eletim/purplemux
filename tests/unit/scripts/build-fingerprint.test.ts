import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const script = path.resolve(process.cwd(), 'scripts/build-fingerprint.js');
const tempRoots: string[] = [];

const makeFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-build-fingerprint-'));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, '.next', 'standalone'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'pages', 'api'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(root, '.next', 'standalone', 'server.js'), '// old build\n');
  await fs.writeFile(path.join(root, 'src', 'pages', 'api', 'example.ts'), 'export default () => "old";\n');
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"fixture"}\n');
  await fs.copyFile(script, path.join(root, 'scripts', 'build-fingerprint.js'));
  return root;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('source production-build fingerprint', () => {
  it('gates pnpm start and records freshness only after the production build steps', async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(packageJson.scripts.start).toMatch(/^node scripts\/build-fingerprint\.js check && /);
    expect(packageJson.scripts.build).toMatch(/tsup && node scripts\/build-fingerprint\.js write$/);
  });

  it('accepts an unchanged standalone build', async () => {
    const root = await makeFixture();
    await execFileAsync(process.execPath, [script, 'write', root]);
    await expect(execFileAsync(process.execPath, [script, 'check', root])).resolves.toMatchObject({
      stdout: '', stderr: '',
    });
  });

  it('rejects the real regression class when API source changes but standalone remains old', async () => {
    const root = await makeFixture();
    await execFileAsync(process.execPath, [script, 'write', root]);
    await fs.writeFile(
      path.join(root, 'src', 'pages', 'api', 'example.ts'),
      'export default () => "new";\n',
    );

    await expect(execFileAsync(process.execPath, [script, 'check', root])).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining('source or production configuration changed after the last build'),
    });
  });

  it('rejects a missing standalone build with an actionable command', async () => {
    const root = await makeFixture();
    await fs.unlink(path.join(root, '.next', 'standalone', 'server.js'));
    await expect(execFileAsync(process.execPath, [script, 'check', root])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Run "pnpm build", then run "pnpm start" again.'),
    });
  });

  it('tracks public assets, messages, environment, and build configuration inputs', async () => {
    const root = await makeFixture();
    await execFileAsync(process.execPath, [script, 'write', root]);
    await fs.mkdir(path.join(root, 'public'), { recursive: true });
    await fs.writeFile(path.join(root, 'public', 'new-asset.txt'), 'new');
    await expect(execFileAsync(process.execPath, [script, 'check', root])).rejects.toMatchObject({ code: 1 });
  });
});
