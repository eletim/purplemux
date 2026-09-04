/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MARKER_RELATIVE_PATH = path.join('.next', 'standalone', '.purplemux-build.json');
const SNAPSHOT_RELATIVE_PATH = '.purplemux-build-input.json';
const INPUT_DIRECTORIES = ['src', 'public', 'messages'];
const INPUT_FILES = [
  'server.ts',
  'next.config.ts',
  'postcss.config.mjs',
  'tsconfig.json',
  'tsup.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  'scripts/post-build.js',
  'scripts/build-fingerprint.js',
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
];

const toPortablePath = (value) => value.split(path.sep).join('/');

const collectFiles = (root, relativeDirectory) => {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return [`${toPortablePath(relativeDirectory)}/<missing>`];

  const files = [];
  const visit = (absolutePath) => {
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = path.join(absolutePath, entry.name);
      if (entry.isDirectory()) visit(child);
      else files.push(toPortablePath(path.relative(root, child)));
    }
  };
  visit(absoluteDirectory);
  return files;
};

const getBuildInputFiles = (root) => [
  ...INPUT_FILES,
  ...INPUT_DIRECTORIES.flatMap((directory) => collectFiles(root, directory)),
].sort();

const getGitIdentity = (root) => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
};

const calculateBuildFingerprint = (root) => {
  const hash = crypto.createHash('sha256');
  hash.update(`git:${getGitIdentity(root)}\0`);
  for (const relativePath of getBuildInputFiles(root)) {
    const absolutePath = path.join(root, relativePath);
    hash.update(relativePath);
    hash.update('\0');
    if (!fs.existsSync(absolutePath)) {
      hash.update('<missing>');
    } else {
      const stat = fs.lstatSync(absolutePath);
      hash.update(stat.isSymbolicLink() ? fs.readlinkSync(absolutePath) : fs.readFileSync(absolutePath));
    }
    hash.update('\0');
  }
  return hash.digest('hex');
};

const beginBuildFingerprint = (root) => {
  const markerPath = path.join(root, MARKER_RELATIVE_PATH);
  const snapshotPath = path.join(root, SNAPSHOT_RELATIVE_PATH);
  fs.rmSync(markerPath, { force: true });
  const snapshot = {
    version: 1,
    fingerprint: calculateBuildFingerprint(root),
    capturedAt: new Date().toISOString(),
  };
  fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  return snapshot;
};

const writeBuildFingerprint = (root) => {
  const markerPath = path.join(root, MARKER_RELATIVE_PATH);
  const snapshotPath = path.join(root, SNAPSHOT_RELATIVE_PATH);
  if (!fs.existsSync(path.join(root, '.next', 'standalone', 'server.js'))) {
    throw new Error('cannot record build fingerprint: .next/standalone/server.js is missing');
  }
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  } catch {
    throw new Error('cannot record build fingerprint: pre-build source snapshot is missing or invalid');
  }
  const current = calculateBuildFingerprint(root);
  if (snapshot?.version !== 1 || snapshot.fingerprint !== current) {
    throw new Error('source or repository identity changed while the production build was running; run "pnpm build" again');
  }
  const marker = {
    version: 1,
    fingerprint: current,
    createdAt: new Date().toISOString(),
  };
  const temporaryMarkerPath = `${markerPath}.tmp`;
  fs.writeFileSync(temporaryMarkerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryMarkerPath, markerPath);
  fs.rmSync(snapshotPath, { force: true });
  return marker;
};

const checkBuildFingerprint = (root) => {
  const standalonePath = path.join(root, '.next', 'standalone', 'server.js');
  const markerPath = path.join(root, MARKER_RELATIVE_PATH);
  if (!fs.existsSync(standalonePath) || !fs.existsSync(markerPath)) {
    return { ok: false, reason: 'missing' };
  }

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (marker?.version !== 1 || typeof marker.fingerprint !== 'string') {
    return { ok: false, reason: 'invalid' };
  }

  const current = calculateBuildFingerprint(root);
  if (current !== marker.fingerprint) return { ok: false, reason: 'stale' };
  return { ok: true, fingerprint: current };
};

const failCheck = (reason) => {
  const detail = reason === 'missing'
    ? 'the production build or its freshness metadata is missing'
    : reason === 'invalid'
      ? 'the production build freshness metadata is invalid'
      : 'source or production configuration changed after the last build';
  process.stderr.write(
    `[purplemux] Refusing to start: ${detail}.\n`
    + '[purplemux] Run "pnpm build", then run "pnpm start" again.\n',
  );
  process.exitCode = 1;
};

if (require.main === module) {
  const action = process.argv[2];
  const root = path.resolve(process.argv[3] || path.join(__dirname, '..'));
  try {
    if (action === 'begin') {
      const snapshot = beginBuildFingerprint(root);
      process.stdout.write(`[build] source fingerprint ${snapshot.fingerprint.slice(0, 12)} captured\n`);
    } else if (action === 'write') {
      const marker = writeBuildFingerprint(root);
      process.stdout.write(`[build] source fingerprint ${marker.fingerprint.slice(0, 12)} recorded\n`);
    } else if (action === 'check') {
      const result = checkBuildFingerprint(root);
      if (!result.ok) failCheck(result.reason);
    } else {
      process.stderr.write('usage: node scripts/build-fingerprint.js <begin|write|check> [repository-root]\n');
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(`[purplemux] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  MARKER_RELATIVE_PATH,
  SNAPSHOT_RELATIVE_PATH,
  beginBuildFingerprint,
  calculateBuildFingerprint,
  checkBuildFingerprint,
  getBuildInputFiles,
  writeBuildFingerprint,
};
