import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import capture from '@/pages/api/tmux/capture';

const mocks = vi.hoisted(() => ({
  cliAuth: vi.fn(), browserAuth: vi.fn(), getServer: vi.fn(), captureExternal: vi.fn(),
}));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: mocks.cliAuth }));
vi.mock('@/lib/auth', () => ({ verifyRequestSession: mocks.browserAuth }));
vi.mock('@/lib/external-server-store', () => ({ getExternalServer: mocks.getServer }));
vi.mock('@/lib/external-server-tmux', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/external-server-tmux')>(),
  captureExternalServerWindow: mocks.captureExternal,
}));

const request = () => ({
  method: 'GET', headers: {},
  query: { externalServerId: 'server-1', sessionId: '$1', windowId: '@2' },
} as unknown as NextApiRequest);
const response = () => {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as NextApiResponse;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cliAuth.mockReturnValue(false);
  mocks.browserAuth.mockResolvedValue(false);
});

describe('tmux capture API', () => {
  it('rejects an unauthenticated external capture before resolving its target', async () => {
    const res = response();

    await capture(request(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(mocks.getServer).not.toHaveBeenCalled();
    expect(mocks.captureExternal).not.toHaveBeenCalled();
  });
});
