// Private launch supervisor. Never logs argv, environment values, body or raw terminal output.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const [mode, dir] = process.argv.slice(2);
const write = (name, value) => {
  const fd = fs.openSync(path.join(dir, name), 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ at: new Date().toISOString(), ...value })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const parent = fs.openSync(dir, 'r'); try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
};
function diagnostic(data) {
  return { bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}
try {
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'launch.json'), 'utf8'));
  if (mode === 'probe') {
    const r = cp.spawnSync(config.executable, [...config.prefix, '--version'], { env: process.env, timeout: 5000, maxBuffer: 65536 });
    write('preflight.json', { stage: 'preflight', ok: r.status === 0 && !r.error, exitCode: r.status, signal: r.signal, errorCode: r.error?.code ?? null, stderr: diagnostic(r.stderr || Buffer.alloc(0)), version: /^codex-cli [\w.+-]+\s*$/.test(String(r.stdout)) ? String(r.stdout).trim() : null });
    process.exit(r.status === 0 && !r.error ? 0 : 1);
  }
  if (mode !== 'run') throw Error('mode');
  // A crash from this point is uncertain. Exclusive file creation prevents a second spawn.
  write('spawn-intent.json', { stage: 'spawn-intent' });
  const child = cp.spawn(config.executable, [...config.prefix, ...config.args], { env: process.env, stdio: ['inherit', 'inherit', 'pipe'] });
  const hash = crypto.createHash('sha256'); let bytes = 0;
  child.stderr.on('data', chunk => { bytes += chunk.length; hash.update(chunk); process.stderr.write(chunk); });
  child.on('spawn', () => write('spawned.json', { stage: 'spawned', pid: child.pid }));
  child.on('error', e => write('spawn-error.json', { stage: 'spawn-error', errorCode: e.code || 'UNKNOWN' }));
  child.on('close', (code, signal) => {
    write('exit.json', { stage: 'exited', exitCode: code, signal, stderr: { bytes, sha256: hash.digest('hex') } });
    process.exitCode = code ?? 1;
  });
} catch {
  // Do not include exception.message: spawn errors can contain the complete prompt/argv.
  process.exitCode = 1;
}
