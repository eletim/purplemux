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
    expect(packageJson.scripts.build).toMatch(/^node scripts\/build-fingerprint\.js begin && /);
    expect(packageJson.scripts.build).toMatch(/tsup && node scripts\/build-fingerprint\.js write$/);
  });

  it('accepts an unchanged standalone build', async () => {
    const root = await makeFixture();
    await execFileAsync(process.execPath, [script, 'begin', root]);
    await execFileAsync(process.execPath, [script, 'write', root]);
    await expect(execFileAsync(process.execPath, [script, 'check', root])).resolves.toMatchObject({
      stdout: '', stderr: '',
    });
  });

  it('rejects the real regression class when API source changes but standalone remains old', async () => {
    const root = await makeFixture();
    await execFileAsync(process.execPath, [script, 'begin', root]);
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

  it('does not certify artifacts when source changes during the build', async () => {
    const root = await makeFixture();
    await execFileAsync(process.execPath, [script, 'begin', root]);
    await fs.writeFile(
      path.join(root, 'src', 'pages', 'api', 'example.ts'),
      'export default () => "changed-during-build";\n',
    );
    await expect(execFileAsync(process.execPath, [script, 'write', root])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('changed while the production build was running'),
    });
    await expect(fs.access(path.join(root, '.next', 'standalone', '.purplemux-build.json'))).rejects.toThrow();
  });

  it('tracks the exact Git identity embedded by the Next build', async () => {
    const root = await makeFixture();
    await execFileAsync('git', ['init'], { cwd: root });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
    await execFileAsync('git', ['add', '.'], { cwd: root });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: root });
    await execFileAsync(process.execPath, [script, 'begin', root]);
    await execFileAsync(process.execPath, [script, 'write', root]);
    await execFileAsync('git', ['commit', '--allow-empty', '-m', 'new identity'], { cwd: root });

    await expect(execFileAsync(process.execPath, [script, 'check', root])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('source or production configuration changed after the last build'),
    });
  });

  it('makes the real pnpm start script exit before its server command for stale source', async () => {
    const root = await makeFixture();
    const startedPath = path.join(root, 'server-started');
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'fingerprint-start-fixture',
      private: true,
      scripts: {
        start: `node ${JSON.stringify(script)} check . && node -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(startedPath)}, 'started')`)}`,
      },
    }));
    await execFileAsync(process.execPath, [script, 'begin', root]);
    await execFileAsync(process.execPath, [script, 'write', root]);
    await fs.writeFile(
      path.join(root, 'src', 'pages', 'api', 'example.ts'),
      'export default () => "stale";\n',
    );

    await expect(execFileAsync('pnpm', ['start'], { cwd: root })).rejects.toMatchObject({ code: 1 });
    await expect(fs.access(startedPath)).rejects.toThrow();
  });

  it('tracks public assets, messages, environment, and build configuration inputs', async () => {
    const root = await makeFixture();
    await execFileAsync(process.execPath, [script, 'begin', root]);
    await execFileAsync(process.execPath, [script, 'write', root]);
    await fs.mkdir(path.join(root, 'public'), { recursive: true });
    await fs.writeFile(path.join(root, 'public', 'new-asset.txt'), 'new');
    await expect(execFileAsync(process.execPath, [script, 'check', root])).rejects.toMatchObject({ code: 1 });
  });
});
