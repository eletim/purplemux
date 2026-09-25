import { createServer, type Server } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendExternalInput, areExternalClientsOnWindow, captureExternalHistory, appendedExternalHistory } from '@/lib/external-target-terminal';
import { captureExtReviewWindow, extReviewTmuxTarget, ExtReviewSnapshotRaceError,
  freezeExtReviewTargets } from '@/lib/ext-review-tmux';
import type { IExtReview } from '@/types/ext-review';

const servers: Server[] = [];
const directories: string[] = [];

const listen = (socket: string): Promise<void> => new Promise((resolve, reject) => {
  const server = createServer();
  servers.push(server);
  server.once('error', reject);
  server.listen(socket, resolve);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('external terminal socket identity', () => {
  it('rejects input and client checks after the registered socket path is replaced', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-external-socket-'));
    directories.push(directory);
    const socketPath = path.join(directory, 'tmux');
    await listen(socketPath);
    const original = await fs.lstat(socketPath, { bigint: true });
    const review: IExtReview = {
      id: 'registered', createdAt: new Date().toISOString(), interactive: true,
      socketPath, socketIdentity: `${original.dev}:${original.ino}`,
      serverPid: '1', sessionId: '$0', sessionCreated: '1', windowIds: ['@0'],
    };
    await fs.rename(socketPath, path.join(directory, 'old-tmux'));
    await listen(socketPath);
    const replacement = await fs.lstat(socketPath, { bigint: true });
    expect(replacement.ino).not.toBe(original.ino);

    const backend = extReviewTmuxTarget(review);
    await expect(sendExternalInput(backend, '$0:@0', new TextEncoder().encode('secret'),
      new AbortController().signal)).rejects.toThrow('External review socket identity changed');
    await expect(areExternalClientsOnWindow(backend, [123], '@0'))
      .rejects.toThrow('External review socket identity changed');
  });
});

describe('external terminal scrollback', () => {
  it('classifies pane replacement during screen and history capture as retryable', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-external-reflow-'));
    directories.push(directory);
    const socketPath = path.join(directory, 'tmux');
    const realTmux = execFileSync('which', ['tmux'], { encoding: 'utf8' }).trim();
    const tmux = (...args: string[]) => execFileSync(realTmux, ['-f', '/dev/null', '-S', socketPath, ...args],
      { encoding: 'utf8' });

    try {
      tmux('new-session', '-d', '-s', 'external', '-x', '90', '-y', '30', 'sleep 300');
      const review: IExtReview = {
        ...await freezeExtReviewTargets({ socketPath, session: 'external', windowTargets: ['@0'] }),
        id: 'reflow', createdAt: new Date().toISOString(), interactive: true,
      };
      const marker = path.join(directory, 'pane-replaced');
      const bin = path.join(directory, 'bin');
      await fs.mkdir(bin);
      await fs.writeFile(path.join(bin, 'tmux'), `#!${process.execPath}
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('capture-pane') && !fs.existsSync(${JSON.stringify(marker)})) {
  fs.writeFileSync(${JSON.stringify(marker)}, '');
  const target = args[args.indexOf('-t') + 1];
  const pane = target.match(/(%\\d+)$/)[1];
  execFileSync(${JSON.stringify(realTmux)}, ['-f', '/dev/null', '-S', ${JSON.stringify(socketPath)},
    'split-window', '-d', '-t', '$0:@0', 'sleep 300']);
  execFileSync(${JSON.stringify(realTmux)}, ['-f', '/dev/null', '-S', ${JSON.stringify(socketPath)},
    'kill-pane', '-t', pane]);
}
process.stdout.write(execFileSync(${JSON.stringify(realTmux)}, args));
`, { mode: 0o700 });
      vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);

      await expect(captureExtReviewWindow(review, '@0')).rejects.toBeInstanceOf(ExtReviewSnapshotRaceError);
      await expect(captureExtReviewWindow(review, '@0')).resolves.toContain('\x1b[8;');
      await fs.rm(marker);
      await expect(captureExternalHistory(review, '@0', new AbortController().signal))
        .rejects.toBeInstanceOf(ExtReviewSnapshotRaceError);
      await expect(captureExternalHistory(review, '@0', new AbortController().signal))
        .resolves.toEqual(expect.any(String));
    } finally {
      try { tmux('kill-server'); } catch { /* tmux already exited */ }
    }
  });

  it('sends only new lines after tmux history passes the 2,000-line capture limit', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-external-history-'));
    directories.push(directory);
    const socketPath = path.join(directory, 'tmux');
    const tmux = (...args: string[]) => execFileSync('tmux', ['-f', '/dev/null', '-S', socketPath, ...args],
      { encoding: 'utf8' });

    try {
      tmux('new-session', '-d', '-s', 'external', '-x', '90', '-y', '30');
      const review: IExtReview = {
        ...await freezeExtReviewTargets({ socketPath, session: 'external', windowTargets: ['@0'] }),
        id: 'history', createdAt: new Date().toISOString(),
      };
      const signal = new AbortController().signal;
      const target = `${review.sessionId}:@0`;
      tmux('send-keys', '-t', target, 'seq -f HISTORY_%04g 1 2100', 'Enter');
      await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-t', target)).toContain('HISTORY_2100'),
        { timeout: 10_000 });
      const before = await vi.waitFor(async () => {
        const history = await captureExternalHistory(review, '@0', signal);
        expect(history).toContain('HISTORY_2000');
        return history!;
      }, { timeout: 10_000 });

      tmux('send-keys', '-t', target, 'seq -f HISTORY_%04g 2101 2500', 'Enter');
      await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-t', target)).toContain('HISTORY_2500'),
        { timeout: 10_000 });
      const after = await vi.waitFor(async () => {
        const history = await captureExternalHistory(review, '@0', signal);
        expect(history).toContain('HISTORY_2450');
        return history!;
      }, { timeout: 10_000 });

      expect(after.startsWith(before)).toBe(false);
      expect(after).toContain('HISTORY_1000');
      const appended = appendedExternalHistory(before, after);
      expect(appended).toContain('HISTORY_2450');
      expect(appended).not.toContain('HISTORY_1000');
      expect(appended.length).toBeLessThan(10_000);
      expect(appendedExternalHistory(after, after)).toBe('');
    } finally {
      try { tmux('kill-server'); } catch { /* tmux already exited */ }
    }
  });
});
