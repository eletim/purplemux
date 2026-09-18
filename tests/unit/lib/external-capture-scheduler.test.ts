import { describe, expect, it, vi } from 'vitest';
import { createExternalCaptureScheduler } from '@/lib/external-capture-scheduler';

describe('external capture scheduler', () => {
  it('keeps only one pending refresh during sustained output bursts', async () => {
    const releases: Array<() => void> = [];
    const capture = vi.fn(() => new Promise<void>((resolve) => { releases.push(resolve); }));
    const onError = vi.fn();
    const requestCapture = createExternalCaptureScheduler(capture, onError);

    for (let i = 0; i < 10_000; i++) requestCapture();
    expect(capture).toHaveBeenCalledTimes(1);

    releases.shift()!();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    for (let i = 0; i < 10_000; i++) requestCapture();
    expect(capture).toHaveBeenCalledTimes(2);

    releases.shift()!();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(3));
    releases.shift()!();
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
  });
});
