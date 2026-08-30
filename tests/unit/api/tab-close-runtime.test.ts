import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  closeTabRuntime: vi.fn(),
  getActiveWorkspaceId: vi.fn(),
}));

vi.mock('@/lib/tab-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tab-runtime')>(),
  closeTabRuntime: mocks.closeTabRuntime,
}));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: () => true }));
vi.mock('@/lib/workspace-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/workspace-store')>(),
  getActiveWorkspaceId: mocks.getActiveWorkspaceId,
}));

import { TabRuntimeError } from '@/lib/tab-runtime';
import uiTabHandler from '@/pages/api/layout/pane/[paneId]/tabs/[tabId]';
import cliTabHandler from '@/pages/api/cli/tabs/[tabId]';

const makeResponse = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return response as typeof response & NextApiResponse;
};

describe('tab close API entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveWorkspaceId.mockResolvedValue('ws-1');
    mocks.closeTabRuntime.mockResolvedValue({});
  });

  it('routes Browser UI close through closeTabRuntime', async () => {
    const req = {
      method: 'DELETE',
      query: { workspace: 'ws-1', paneId: 'pane-1', tabId: 'tab-1' },
    } as unknown as NextApiRequest;
    const res = makeResponse();

    await uiTabHandler(req, res);

    expect(mocks.closeTabRuntime).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      paneId: 'pane-1',
      tabId: 'tab-1',
    });
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('routes CLI close through the same runtime and preserves its response', async () => {
    const req = {
      method: 'DELETE',
      headers: {},
      query: { workspaceId: 'ws-1', tabId: 'tab-1' },
    } as unknown as NextApiRequest;
    const res = makeResponse();

    await cliTabHandler(req, res);

    expect(mocks.closeTabRuntime).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      tabId: 'tab-1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it.each([
    ['Browser UI', uiTabHandler, { workspace: 'ws-1', paneId: 'pane-1', tabId: 'missing' }],
    ['CLI', cliTabHandler, { workspaceId: 'ws-1', tabId: 'missing' }],
  ])('preserves the %s not-found contract', async (_name, handler, query) => {
    mocks.closeTabRuntime.mockRejectedValue(new TabRuntimeError(404, { error: 'Tab not found' }));
    const req = { method: 'DELETE', headers: {}, query } as unknown as NextApiRequest;
    const res = makeResponse();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Tab not found' });
  });

  it('keeps CLI workspace validation at the handler boundary', async () => {
    const req = {
      method: 'DELETE',
      headers: {},
      query: { tabId: 'tab-1' },
    } as unknown as NextApiRequest;
    const res = makeResponse();

    await cliTabHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'workspaceId is required' });
    expect(mocks.closeTabRuntime).not.toHaveBeenCalled();
  });
});
