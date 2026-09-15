import { execFile as execFileCallback } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import type { ICreateExtReview, IExtReview } from '@/types/ext-review';

const execFile = promisify(execFileCallback);
export class ExtReviewError extends Error {}

export const validateExtReviewInput = (input: ICreateExtReview): void => {
  if (!input || typeof input.socketPath !== 'string' || !path.isAbsolute(input.socketPath)
    || typeof input.session !== 'string' || !input.session.length || /[:\n\r\0]/.test(input.session)
    || !Array.isArray(input.windowTargets) || !input.windowTargets.length
    || input.windowTargets.some((target) => typeof target !== 'string' || !/^@\d+$/.test(target))
    || new Set(input.windowTargets).size !== input.windowTargets.length) {
    throw new ExtReviewError('Specify an absolute socketPath, exact session, and unique @window IDs');
  }
};

const socketIdentity = async (socketPath: string): Promise<string> => {
  const stat = await fs.lstat(socketPath, { bigint: true });
  if (!stat.isSocket()) throw new ExtReviewError('socketPath must be a socket, not a symlink');
  // The app owns the -L purple server; it is not an external review target.
  const managedSocket = path.join(process.env.TMUX_TMPDIR || '/tmp', `tmux-${process.getuid?.()}`, 'purple');
  const managed = await fs.lstat(managedSocket, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (managed && stat.dev === managed.dev && stat.ino === managed.ino) {
    throw new ExtReviewError('The purplemux-owned tmux socket is not external');
  }
  return `${stat.dev}:${stat.ino}:${stat.ctimeNs}`;
};

const inspectTarget = async (socketPath: string, target: string): Promise<string[]> => {
  // Check the explicit session first: older tmux servers can crash when
  // display-message targets a deleted session ID. This does not enumerate.
  await execFile('tmux', ['-N', '-S', socketPath, 'has-session', '-t', target.split(':')[0]], { timeout: 5000 });
  const { stdout } = await execFile('tmux', [
    '-N', '-S', socketPath, 'display-message', '-p', '-t', target,
    '#{pid}\t#{session_id}\t#{session_created}\t#{window_id}',
  ], { timeout: 5000 });
  const fields = stdout.trim().split('\t');
  if (fields.length !== 4 || !/^\d+$/.test(fields[0]) || !/^\$\d+$/.test(fields[1])
    || !/^\d+$/.test(fields[2]) || !/^@\d+$/.test(fields[3])) {
    throw new ExtReviewError('External tmux target is unavailable');
  }
  return fields;
};

export const freezeExtReviewTargets = async (input: ICreateExtReview): Promise<Omit<IExtReview, 'id' | 'createdAt'>> => {
  validateExtReviewInput(input);
  try {
    const identity = await socketIdentity(input.socketPath);
    const [serverPid, sessionId, sessionCreated] = await inspectTarget(input.socketPath,
      /^\$\d+$/.test(input.session) ? `${input.session}:` : `=${input.session}:`);
    for (const windowId of input.windowTargets) {
      const fields = await inspectTarget(input.socketPath, `${sessionId}:${windowId}`);
      if (fields.join('\t') !== [serverPid, sessionId, sessionCreated, windowId].join('\t')) {
        throw new ExtReviewError('Window is not in the specified session');
      }
    }
    if (await socketIdentity(input.socketPath) !== identity) throw new ExtReviewError('Socket changed during validation');
    return { socketPath: input.socketPath, socketIdentity: identity, serverPid, sessionId,
      sessionCreated, windowIds: [...input.windowTargets] };
  } catch (error) {
    if (error instanceof ExtReviewError) throw error;
    throw new ExtReviewError('External tmux targets are unavailable');
  }
};

/** Resolve only the frozen allowlist; never fall back to names or enumerate resources. */
export const resolveExtReviewTargets = async (review: IExtReview): Promise<IExtReview> => {
  try {
    if (await socketIdentity(review.socketPath) !== review.socketIdentity) {
      throw new ExtReviewError('External review socket identity changed');
    }
    const [pid, sessionId, created] = await inspectTarget(review.socketPath, `${review.sessionId}:`);
    if (pid !== review.serverPid || sessionId !== review.sessionId || created !== review.sessionCreated) {
      throw new ExtReviewError('External review resource identity changed');
    }
    const current = await freezeExtReviewTargets({ socketPath: review.socketPath,
      session: review.sessionId, windowTargets: review.windowIds });
    if (current.socketIdentity !== review.socketIdentity || current.serverPid !== review.serverPid
      || current.sessionId !== review.sessionId || current.sessionCreated !== review.sessionCreated) {
      throw new ExtReviewError('External review resource identity changed');
    }
    return structuredClone(review);
  } catch (error) {
    if (error instanceof ExtReviewError) throw error;
    throw new ExtReviewError('External review targets are unavailable');
  }
};

/** Capture only panes in one frozen window. No attach, buffers, resize or input. */
export const captureExtReviewWindow = async (review: IExtReview, windowId: string,
  signal?: AbortSignal): Promise<string> => {
  if (!review.windowIds.includes(windowId)) throw new ExtReviewError('Window is not approved');
  await resolveExtReviewTargets(review);
  const target = `${review.sessionId}:${windowId}`;
  const run = async (args: string[]) => (await execFile('tmux', ['-N', '-S', review.socketPath, ...args],
    { timeout: 5000, maxBuffer: 4 * 1024 * 1024, signal })).stdout;
  const list = () => run(['list-panes', '-t', target, '-F',
    '#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_left}\t#{pane_top}\t#{pane_width}\t#{pane_height}']);
  const before = await list();
  const panes = before.trim().split('\n').map((line) => line.split('\t'));
  if (panes.some(([session, window, pane, ...geometry]) => session !== review.sessionId
    || window !== windowId || !/^%\d+$/.test(pane) || geometry.length !== 4
    || geometry.some((value) => !/^\d+$/.test(value)))) {
    throw new ExtReviewError('Frozen window panes are unavailable');
  }
  let screen = '\x1b[?25l\x1b[0m\x1b[2J\x1b[H';
  for (const [, , pane, left, top, , height] of panes) {
    const content = await run(['capture-pane', '-p', '-e', '-N', '-t', `${target}.${pane}`]);
    const lines = content.split('\n').slice(0, Number(height));
    lines.forEach((line, row) => {
      screen += `\x1b[${Number(top) + row + 1};${Number(left) + 1}H\x1b[0m${line}`;
    });
  }
  // Do not publish a snapshot if identities or pane membership changed mid-read.
  await resolveExtReviewTargets(review);
  if (await list() !== before) throw new ExtReviewError('Frozen window panes changed during observation');
  return `${screen}\x1b[0m\x1b[H`;
};
