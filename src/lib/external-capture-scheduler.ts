/** Collapse bursts of control-mode events into one pending window refresh. */
export const createExternalCaptureScheduler = (
  capture: () => Promise<void>,
  onError: () => void,
): (() => void) => {
  let running = false;
  let pending = false;
  let failed = false;

  const drain = async () => {
    while (pending && !failed) {
      pending = false;
      try {
        await capture();
      } catch {
        failed = true;
        onError();
      }
    }
    running = false;
  };

  return () => {
    if (failed) return;
    pending = true;
    if (running) return;
    running = true;
    void drain();
  };
};
