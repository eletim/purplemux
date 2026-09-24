import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasSession: vi.fn(),
  capturePaneContentWithHistory: vi.fn(),
}));

vi.mock('@/lib/tmux', () => ({
  hasSession: mocks.hasSession,
  capturePaneContentWithHistory: mocks.capturePaneContentWithHistory,
}));

import handler from '@/pages/api/tmux/history';

const makeResponse = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return response as typeof response & NextApiResponse;
};

const request = (overrides: Partial<NextApiRequest> = {}) => ({
  method: 'GET',
  query: { session: 'pt-workspace-pane-tab' },
  ...overrides,
}) as NextApiRequest;

describe('tmux history API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSession.mockResolvedValue(true);
    mocks.capturePaneContentWithHistory.mockResolvedValue('complete history');
  });

  it('captures all history as joined logical lines without caching it', async () => {
    const res = makeResponse();
    await handler(request(), res);

    expect(mocks.capturePaneContentWithHistory).toHaveBeenCalledWith(
      'pt-workspace-pane-tab',
      'all',
      { joinWrapped: true },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ content: 'complete history' });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('rejects missing sessions before attempting a capture', async () => {
    mocks.hasSession.mockResolvedValue(false);
    const res = makeResponse();
    await handler(request(), res);

    expect(res.statusCode).toBe(404);
    expect(mocks.capturePaneContentWithHistory).not.toHaveBeenCalled();
  });
});
