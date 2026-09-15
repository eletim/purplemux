import type { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { loadExtReviewDefinition } from '@/lib/ext-review-store';
import { captureExtReviewWindow, ExtReviewSnapshotRaceError, resolveExtReviewTargets } from '@/lib/ext-review-tmux';
import { extReviewObservers } from '@/lib/ext-review-observation-resources';
import { encodeStdout, MSG_HEARTBEAT } from '@/lib/terminal-protocol';

/** A screen observer, deliberately separate from the managed interactive PTY. */
export const handleExtReviewObservation = async (ws: WebSocket, request: IncomingMessage): Promise<void> => {
  const params = new URL(request.url || '', 'http://localhost').searchParams;
  const reviewId = params.get('reviewId');
  const windowId = params.get('windowId');
  if (!reviewId || !windowId || !/^@\d+$/.test(windowId)
    || [...params.keys()].some((key) => !['reviewId', 'windowId'].includes(key))
    || params.getAll('reviewId').length !== 1 || params.getAll('windowId').length !== 1) {
    ws.close(1008, 'Only reviewId and an approved windowId are accepted');
    return;
  }
  if (extReviewObservers.size >= 32) {
    ws.close(1013, 'Max observations exceeded');
    return;
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastHeartbeat = Date.now();
  let previous = '';
  const abort = new AbortController();
  const stop = (code: number, reason: string) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    abort.abort(); // cancels only our read-only tmux command process
    extReviewObservers.delete(ws);
    if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
  };
  extReviewObservers.set(ws, { reviewId, stop });
  ws.on('close', () => stop(1000, 'Disconnected'));
  ws.on('error', () => stop(1011, 'Observation connection failed'));
  // Deny by default, including text commands, input, resize, kill and future opcodes.
  ws.on('message', (raw, binary) => {
    const bytes = raw instanceof ArrayBuffer ? Buffer.from(raw)
      : Array.isArray(raw) ? Buffer.concat(raw) : raw;
    if (!binary || bytes.length !== 1 || bytes[0] !== MSG_HEARTBEAT) {
      stop(1008, 'External review observation is read-only');
      return;
    }
    lastHeartbeat = Date.now();
    if (!stopped && ws.readyState === WebSocket.OPEN) ws.send(new Uint8Array([MSG_HEARTBEAT]));
  });

  const poll = async () => {
    try {
      if (stopped || ws.readyState !== WebSocket.OPEN) return stop(1000, 'Disconnected');
      if (Date.now() - lastHeartbeat > 90_000) return stop(1001, 'Heartbeat timeout');
      // Re-read the definition so deletion in a separate Next process also ends observation.
      const review = await loadExtReviewDefinition(reviewId, abort.signal);
      if (stopped) return;
      if (!review) return stop(1000, 'Review deleted');
      if (!review.windowIds.includes(windowId)) return stop(1008, 'Window is not approved');
      // Continue validating availability even while output is backpressured.
      if (ws.bufferedAmount < 1024 * 1024) {
        const screen = await captureExtReviewWindow(review, windowId, abort.signal);
        if (stopped || ws.readyState !== WebSocket.OPEN) return;
        if (screen !== previous) {
          ws.send(encodeStdout(screen));
          previous = screen;
        }
      } else {
        await resolveExtReviewTargets(review, abort.signal);
      }
    } catch (error) {
      if (!(error instanceof ExtReviewSnapshotRaceError)) {
        stop(1011, 'Frozen review targets are unavailable');
        return;
      }
      // Discard the inconsistent frame; the next poll revalidates from scratch.
    }
    if (!stopped) timer = setTimeout(() => { void poll(); }, 250);
  };
  await poll();
};
