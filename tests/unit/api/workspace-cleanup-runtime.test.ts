import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteWorkspaceIfEmpty: vi.fn(),
}));

vi.mock('@/lib/workspace-store', () => ({
  deleteWorkspaceIfEmpty: mocks.deleteWorkspaceIfEmpty,
}));

import handler from '@/pages/api/workspace/cleanup-empty';

const makeResponse = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  };
  return response as typeof response & NextApiResponse;
};

const request = (overrides: Partial<NextApiRequest> = {}): NextApiRequest => ({
  method: 'POST',
  headers: {},
  query: {},
  body: { workspaceIds: ['ws-empty', 'ws-busy'] },
  ...overrides,
} as NextApiRequest);

describe('empty workspace cleanup API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses conditional deletion for every unique target and returns partial results', async () => {
    mocks.deleteWorkspaceIfEmpty
      .mockResolvedValueOnce({ workspaceId: 'ws-empty', status: 'deleted', deleted: true })
      .mockResolvedValueOnce({
        workspaceId: 'ws-busy', status: 'not-empty', deleted: false, tabCount: 1, sessionCount: 1,
      });
    const res = makeResponse();

    await handler(request({ body: { workspaceIds: ['ws-empty', 'ws-busy', 'ws-empty'] } }), res);

    expect(res.statusCode).toBe(200);
    expect(mocks.deleteWorkspaceIfEmpty.mock.calls).toEqual([['ws-empty'], ['ws-busy']]);
    expect(res.body).toEqual({ results: [
      { workspaceId: 'ws-empty', status: 'deleted', deleted: true },
      { workspaceId: 'ws-busy', status: 'not-empty', deleted: false, tabCount: 1, sessionCount: 1 },
    ] });
  });

  it('continues after a target fails closed', async () => {
    mocks.deleteWorkspaceIfEmpty
      .mockRejectedValueOnce(new Error('layout state is invalid'))
      .mockResolvedValueOnce({ workspaceId: 'ws-busy', status: 'deleted', deleted: true });
    const res = makeResponse();

    await handler(request(), res);

    expect(res.body).toEqual({ results: [
      { workspaceId: 'ws-empty', status: 'error', deleted: false, error: 'layout state is invalid' },
      { workspaceId: 'ws-busy', status: 'deleted', deleted: true },
    ] });
  });

  it('validates the method and request body before deletion', async () => {
    const wrongMethod = makeResponse();
    await handler(request({ method: 'DELETE' }), wrongMethod);
    expect(wrongMethod.statusCode).toBe(405);
    expect(wrongMethod.headers.Allow).toBe('POST');

    const invalidBody = makeResponse();
    await handler(request({ body: { workspaceIds: ['valid', 1] } }), invalidBody);
    expect(invalidBody.statusCode).toBe(400);
    expect(mocks.deleteWorkspaceIfEmpty).not.toHaveBeenCalled();
  });
});
