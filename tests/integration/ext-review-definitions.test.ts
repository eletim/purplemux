import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { freezeExtReviewTargets, resolveExtReviewTargets } from '@/lib/ext-review-tmux';

let directory: string;
let socket: string;
const tmux = (...args: string[]) => execFileSync('tmux', ['-f', '/dev/null', '-S', socket, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const input = () => ({ socketPath: socket, session: 'external', windowTargets: ['@0'] });

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-review-'));
  socket = path.join(directory, 'tmux');
  tmux('new-session', '-d', '-s', 'external', 'sleep 300');
});
afterEach(async () => {
  try { tmux('kill-server'); } catch {}
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('external review identities with a real tmux server', () => {
  it('persists independently and deletes only the definition without tmux access', async () => {
    vi.spyOn(os, 'homedir').mockReturnValue(directory);
    vi.resetModules();
    const store = await import('@/lib/ext-review-store');
    const review = await store.createExtReview(input());
    tmux('new-window', '-t', 'external', 'sleep 300');
    tmux('rename-session', '-t', 'external', 'renamed');
    vi.resetModules();
    const reloaded = await import('@/lib/ext-review-store');
    expect(await reloaded.getExtReview(review.id)).toEqual(review);
    expect(review.windowIds).toEqual(['@0']);
    expect(await fs.readdir(path.join(directory, '.purplemux'))).toEqual(['ext-reviews.json']);
    expect(await reloaded.deleteExtReview(review.id)).toBe(true);
    expect(tmux('display-message', '-p', '-t', '$0:@0', '#{window_id}')).toBe('@0');
    const second = await reloaded.createExtReview({ ...input(), session: 'renamed' });
    tmux('kill-server');
    expect(await reloaded.deleteExtReview(second.id)).toBe(true);
    expect(await reloaded.listExtReviews()).toEqual([]);
  });

  it('rejects omitted, wildcard, duplicate, unknown, and foreign targets', async () => {
    for (const invalid of [undefined, { ...input(), socketPath: 'default' },
      { ...input(), session: '*' }, { ...input(), windowTargets: [] },
      { ...input(), windowTargets: ['@0', '@0'] }, { ...input(), windowTargets: ['*'] },
      { ...input(), windowTargets: ['@99999'] }]) {
      await expect(freezeExtReviewTargets(invalid as ReturnType<typeof input>)).rejects.toThrow();
    }
    tmux('new-session', '-d', '-s', 'other', 'sleep 300');
    await expect(freezeExtReviewTargets({ ...input(), windowTargets: ['@1'] })).rejects.toThrow();
    const link = path.join(directory, 'link');
    await fs.symlink(socket, link);
    await expect(freezeExtReviewTargets({ ...input(), socketPath: link })).rejects.toThrow();
  });

  it('rejects the app-owned socket, including another path to the same socket', async () => {
    vi.stubEnv('TMUX_TMPDIR', directory);
    const managedDirectory = path.join(directory, `tmux-${process.getuid?.()}`);
    await fs.mkdir(managedDirectory);
    await fs.link(socket, path.join(managedDirectory, 'purple'));
    await expect(freezeExtReviewTargets(input())).rejects.toThrow('not external');
  });

  it('rejects replaced windows, sessions, and servers rather than following names or indices', async () => {
    const frozen = { ...await freezeExtReviewTargets(input()), id: 'review', createdAt: 'now' };
    tmux('new-window', '-t', 'external', 'sleep 300');
    tmux('kill-window', '-t', '$0:@0');
    tmux('new-window', '-t', 'external:0', 'sleep 300');
    await expect(resolveExtReviewTargets(frozen)).rejects.toThrow();
    tmux('new-session', '-d', '-s', 'keeper', 'sleep 300');
    tmux('kill-session', '-t', 'external');
    tmux('new-session', '-d', '-s', 'external', 'sleep 300');
    await expect(resolveExtReviewTargets(frozen)).rejects.toThrow();
    tmux('kill-server');
    await vi.waitFor(() => {
      try { tmux('has-session', '-t', 'external'); }
      catch { tmux('new-session', '-d', '-s', 'external', 'sleep 300'); }
    }, { timeout: 5000 });
    await expect(resolveExtReviewTargets(frozen)).rejects.toThrow();
  });
});
