import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteWorkspaceIfEmpty: vi.fn(),
  getWorkspaceById: vi.fn(),
  verifyCliToken: vi.fn(),
}));

vi.mock('@/lib/workspace-store', () => ({
  deleteWorkspaceIfEmpty: mocks.deleteWorkspaceIfEmpty,
  getWorkspaceById: mocks.getWorkspaceById,
}));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: mocks.verifyCliToken }));

import handler from '@/pages/api/cli/workspaces/[workspaceId]';

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

const request = (overrides: Partial<NextApiRequest>): NextApiRequest => ({
  method: 'DELETE',
  headers: {},
  query: { workspaceId: 'ws-target', ifEmpty: 'true' },
  body: {},
  ...overrides,
} as NextApiRequest);

describe('public workspace deletion API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCliToken.mockReturnValue(true);
  });

  it.each([
    [{ workspaceId: 'ws-target', status: 'deleted', deleted: true }, 200],
    [{ workspaceId: 'ws-target', status: 'absent', deleted: false }, 200],
    [{ workspaceId: 'ws-target', status: 'not-empty', deleted: false, tabCount: 1, sessionCount: 1 }, 409],
  ])('returns the shared machine-readable result %#', async (result, status) => {
    mocks.deleteWorkspaceIfEmpty.mockResolvedValue(result);
    const res = makeResponse();
    await handler(request({}), res);
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual(result);
    expect(mocks.deleteWorkspaceIfEmpty).toHaveBeenCalledWith('ws-target');
  });

  it('requires the conditional deletion guard before invoking the mutation', async () => {
    const res = makeResponse();
    await handler(request({ query: { workspaceId: 'ws-target' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ workspaceId: 'ws-target' });
    expect(mocks.deleteWorkspaceIfEmpty).not.toHaveBeenCalled();
  });

  it('provides authoritative present and absent state for reconciliation', async () => {
    const workspace = { id: 'ws-target', name: 'Target', directories: ['/target'] };
    mocks.getWorkspaceById.mockResolvedValueOnce(workspace).mockResolvedValueOnce(undefined);

    const present = makeResponse();
    await handler(request({ method: 'GET', query: { workspaceId: 'ws-target' } }), present);
    expect(present.body).toEqual({ workspaceId: 'ws-target', state: 'present', workspace });

    const absent = makeResponse();
    await handler(request({ method: 'GET', query: { workspaceId: 'ws-target' } }), absent);
    expect(absent.body).toEqual({ workspaceId: 'ws-target', state: 'absent', workspace: null });
  });

  it('authenticates before reading or mutating state', async () => {
    mocks.verifyCliToken.mockReturnValue(false);
    const res = makeResponse();
    await handler(request({}), res);
    expect(res.statusCode).toBe(403);
    expect(mocks.deleteWorkspaceIfEmpty).not.toHaveBeenCalled();
  });
});
