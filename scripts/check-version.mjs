import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageVersion = packageJson.version;
const targetRef = process.argv.slice(2).find((arg) => arg !== '--')
  ?? process.env.GITHUB_BASE_REF
  ?? process.env.GITHUB_REF_NAME
  ?? '';

if (typeof packageVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageVersion)) {
  throw new Error(`package.json has an invalid version: ${String(packageVersion)}`);
}

const cliVersion = execFileSync(process.execPath, ['bin/purplemux.js', '--version'], {
  cwd: root,
  encoding: 'utf8',
}).trim();

if (cliVersion !== packageVersion) {
  throw new Error(`purplemux --version returned ${cliVersion}; expected ${packageVersion}`);
}

const developmentMatch = targetRef.match(/^(?:refs\/heads\/)?dev\/v(.+)$/);
const releaseMatch = targetRef.match(/^(?:refs\/tags\/)?v(.+)$/);
const expectedVersion = developmentMatch?.[1] ?? releaseMatch?.[1];

if (expectedVersion && expectedVersion !== packageVersion) {
  throw new Error(`${targetRef} requires package.json version ${expectedVersion}; found ${packageVersion}`);
}

console.log(`Version contract verified: ${packageVersion}`);
