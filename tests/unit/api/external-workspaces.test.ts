import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import workspaces from '@/pages/api/cli/external-servers/[serverId]/workspaces';
import tabs from '@/pages/api/cli/external-servers/[serverId]/workspaces/[workspaceId]/tabs';
import { ExternalServerError } from '@/lib/external-server-tmux';

const mocks = vi.hoisted(() => ({
  cliAuth: vi.fn(), browserAuth: vi.fn(), getSource: vi.fn(), createTab: vi.fn(),
}));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: mocks.cliAuth }));
vi.mock('@/lib/auth', () => ({ verifyRequestSession: mocks.browserAuth }));
vi.mock('@/lib/external-workspace-adapter', () => ({
  getExternalWorkspaceSource: mocks.getSource,
  createExternalWorkspaceTab: mocks.createTab,
}));

const request = (method: string, body?: unknown): NextApiRequest => ({
  method, body, headers: {}, query: { serverId: 'server-1', workspaceId: '$4' },
} as unknown as NextApiRequest);
const response = () => {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as NextApiResponse;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cliAuth.mockReturnValue(true);
  mocks.browserAuth.mockResolvedValue(false);
});

describe('external Workspace/Tab API', () => {
  it.each(['CLI', 'browser'])('returns the fresh adapter view with %s authentication', async (access) => {
    mocks.cliAuth.mockReturnValue(access === 'CLI');
    mocks.browserAuth.mockResolvedValue(access === 'browser');
    const source = { serverId: 'server-1', name: 'dev', exists: true, workspaces: [] };
    mocks.getSource.mockResolvedValue(source);
    const req = request('GET');
    req.headers.cookie = 'session-token=valid';
    const res = response();

    await workspaces(req, res);

    expect(mocks.getSource).toHaveBeenCalledWith('server-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(source);
  });

  it('adds a Tab to an exact Workspace and returns its stable selection target', async () => {
    const created = { tabId: '@7', workspaceId: '$4', sessionCreated: '1750000001',
      externalTerminalTarget: { serverId: 'server-1', sessionId: '$4', windowId: '@7' } };
    mocks.createTab.mockResolvedValue(created);
    const res = response();

    await tabs(request('POST', { sessionCreated: '1750000001' }), res);

    expect(mocks.createTab).toHaveBeenCalledWith('server-1',
      { id: '$4', sessionCreated: '1750000001' });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });

  it('rejects unauthenticated access and malformed exact identities', async () => {
    mocks.cliAuth.mockReturnValue(false);
    let res = response();
    await workspaces(request('GET'), res);
    expect(res.status).toHaveBeenCalledWith(403);

    mocks.cliAuth.mockReturnValue(true);
    const malformed = request('POST', { sessionCreated: 'not-an-identity' });
    malformed.query.workspaceId = 'by-name';
    res = response();
    await tabs(malformed, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.createTab).not.toHaveBeenCalled();
  });

  it('maps missing registrations and exact-session drift without retrying', async () => {
    mocks.getSource.mockResolvedValue(undefined);
    let res = response();
    await workspaces(request('GET'), res);
    expect(res.status).toHaveBeenCalledWith(404);

    mocks.createTab.mockRejectedValue(new ExternalServerError('External tmux session identity changed'));
    res = response();
    await tabs(request('POST', { sessionCreated: '1750000001' }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'External tmux session identity changed' });
    expect(mocks.createTab).toHaveBeenCalledOnce();
  });

  it('advertises only the supported methods', async () => {
    for (const [handler, method, allow] of [[workspaces, 'POST', 'GET'], [tabs, 'GET', 'POST']] as const) {
      const res = response();
      await handler(request(method), res);
      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', allow);
    }
  });
});
