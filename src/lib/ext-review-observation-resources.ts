// Shared by the standalone server and Next API bundles. These callbacks own
// only local observation resources, never the external terminal.
const state = globalThis as typeof globalThis & {
  __purplemuxExtReviewObservers?: Map<object, { reviewId: string; stop: (code: number, reason: string) => void }>;
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
