import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import collection from '@/pages/api/cli/ext-reviews';
import definition from '@/pages/api/cli/ext-reviews/[reviewId]';
import { ExtReviewError } from '@/lib/ext-review-tmux';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), session: vi.fn(), create: vi.fn(), list: vi.fn(), get: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: mocks.auth }));
vi.mock('@/lib/auth', () => ({ verifyRequestSession: mocks.session }));
vi.mock('@/lib/ext-review-store', () => ({ createExtReview: mocks.create, listExtReviews: mocks.list,
  getExtReview: mocks.get, deleteExtReview: mocks.remove }));
const request = (method: string, body?: unknown) => ({ method, body, headers: {}, query: { reviewId: 'review' } }) as unknown as NextApiRequest;
const response = () => {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockReturnValue(true); mocks.session.mockResolvedValue(false); });

describe('external review API', () => {
  it('rejects every supported operation without valid CLI or browser authentication', async () => {
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
  it.each(['browser', 'CLI'])('allows %s authentication to create, list, get, and delete definitions', async (access) => {
    mocks.auth.mockReturnValue(access === 'CLI');
    mocks.session.mockResolvedValue(access === 'browser');
    const review = { id: 'review', windowIds: ['@1'] };
    const input = { socketPath: '/known/socket', session: 'external', windowTargets: ['@1'] };
    mocks.create.mockResolvedValue(review);
    mocks.list.mockResolvedValue([review]);
    mocks.get.mockResolvedValue(review);
    mocks.remove.mockResolvedValue(true);
    for (const [handler, method, status, body] of [
      [collection, 'POST', 201, { ...review, url: '/ext-review/review' }],
      [collection, 'GET', 200, { reviews: [review] }],
      [definition, 'GET', 200, review],
      [definition, 'DELETE', 200, { deleted: true }],
    ] as const) {
      const req = request(method, input);
      req.headers.cookie = 'session-token=valid-session';
      const res = response();
      await handler(req, res as unknown as NextApiResponse);
      if (access === 'browser') expect(mocks.session).toHaveBeenLastCalledWith(req.headers.cookie);
      else expect(mocks.session).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(status);
      expect(res.json).toHaveBeenCalledWith(body);
    }
    expect(mocks.create).toHaveBeenCalledWith(input);
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.get).toHaveBeenCalledWith('review');
    expect(mocks.remove).toHaveBeenCalledWith('review');
  });
  it('rejects invalid browser sessions without accessing definitions', async () => {
    mocks.auth.mockReturnValue(false);
    for (const [handler, method] of [[collection, 'GET'], [collection, 'POST'], [definition, 'GET'], [definition, 'DELETE']] as const) {
      const req = request(method);
      req.headers.cookie = 'session-token=expired-or-invalid';
      const res = response();
      await handler(req, res as unknown as NextApiResponse);
      expect(mocks.session).toHaveBeenLastCalledWith(req.headers.cookie);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('does not expose target updates or additional lifecycle operations', async () => {
    for (const [handler, method, allow] of [[collection, 'PUT', 'GET, POST'], [definition, 'PUT', 'GET, DELETE'], [definition, 'PATCH', 'GET, DELETE'], [definition, 'POST', 'GET, DELETE']] as const) {
      const res = response();
      await handler(request(method), res as unknown as NextApiResponse);
      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', allow);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('creates explicit definitions and reports invalid input', async () => {
    const input = { socketPath: '/known/socket', session: 'external', windowTargets: ['@1'], interactive: true };
    mocks.create.mockResolvedValue({ id: 'review' });
    const res = response();
    await collection(request('POST', input), res as unknown as NextApiResponse);
    expect(mocks.create).toHaveBeenCalledWith({ socketPath: '/known/socket', session: 'external', windowTargets: ['@1'] });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 'review', url: '/ext-review/review' });
    expect(mocks.session).not.toHaveBeenCalled();
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
