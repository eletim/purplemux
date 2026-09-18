import { WebSocket } from 'ws';

// Shared by the standalone server and Next API bundles. These callbacks own
// only local observation resources, never the external terminal.
const state = globalThis as typeof globalThis & {
  __purplemuxExtReviewObservers?: Map<WebSocket, { reviewId: string; stop: (code: number, reason: string) => void }>;
};
export const extReviewObservers = state.__purplemuxExtReviewObservers ??= new Map();

export const stopExtReviewObservations = (reviewId?: string): void => {
  for (const observer of extReviewObservers.values()) {
    if (reviewId === undefined || observer.reviewId === reviewId) {
      observer.stop(reviewId === undefined ? 1001 : 1000,
        reviewId === undefined ? 'Server shutting down' : 'Review deleted');
    }
  }
};

export const gracefulExtReviewObservationShutdown = async (): Promise<void> => {
  const closing = [...extReviewObservers.keys()].map((ws) => new Promise<void>((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    const finish = () => {
      clearTimeout(timer);
      ws.off('close', finish);
      resolve();
    };
    const timer = setTimeout(finish, 2000);
    ws.once('close', finish);
  }));
  stopExtReviewObservations();
  await Promise.all(closing);
};
