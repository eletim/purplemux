import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import collection from '@/pages/api/cli/ext-reviews';
import definition from '@/pages/api/cli/ext-reviews/[reviewId]';
import { ExtReviewError } from '@/lib/ext-review-tmux';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: mocks.auth }));
vi.mock('@/lib/ext-review-store', () => ({ createExtReview: mocks.create, listExtReviews: mocks.list,
  getExtReview: mocks.get, deleteExtReview: mocks.remove }));
const request = (method: string, body?: unknown) => ({ method, body, query: { reviewId: 'review' } }) as unknown as NextApiRequest;
const response = () => {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue(true); });

describe('external review API', () => {
  it('requires CLI authentication for every supported operation', async () => {
    mocks.auth.mockReturnValue(false);
    for (const [handler, method] of [[collection, 'GET'], [collection, 'POST'], [definition, 'GET'], [definition, 'DELETE']] as const) {
      const res = response();
      await handler(request(method), res as unknown as NextApiResponse);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('creates explicit definitions and reports invalid input', async () => {
    const input = { socketPath: '/known/socket', session: 'external', windowTargets: ['@1'] };
    mocks.create.mockResolvedValue({ id: 'review' });
    const res = response();
    await collection(request('POST', input), res as unknown as NextApiResponse);
    expect(mocks.create).toHaveBeenCalledWith(input);
    expect(res.status).toHaveBeenCalledWith(201);
    mocks.create.mockRejectedValue(new ExtReviewError('Invalid targets'));
    await collection(request('POST'), res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it('returns conflict for changed resources and deletes without resolving targets', async () => {
    mocks.get.mockRejectedValue(new ExtReviewError('Identity changed'));
    const res = response();
    await definition(request('GET'), res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(409);
    mocks.get.mockClear();
    mocks.remove.mockResolvedValue(true);
    await definition(request('DELETE'), res as unknown as NextApiResponse);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith('review');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
