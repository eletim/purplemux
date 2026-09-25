import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import collection from '@/pages/api/cli/external-servers';
import registration from '@/pages/api/cli/external-servers/[serverId]';
import { ExternalServerError } from '@/lib/external-server-tmux';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), session: vi.fn(), register: vi.fn(), list: vi.fn(), unregister: vi.fn(),
}));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: mocks.auth }));
vi.mock('@/lib/auth', () => ({ verifyRequestSession: mocks.session }));
vi.mock('@/lib/external-server-store', () => ({
  registerExternalServer: mocks.register,
  listExternalServers: mocks.list,
  unregisterExternalServer: mocks.unregister,
}));

const request = (method: string, body?: unknown) => ({
  method, body, headers: {}, query: { serverId: 'server-1' },
}) as unknown as NextApiRequest;
const response = () => {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockReturnValue(true);
  mocks.session.mockResolvedValue(false);
});

describe('external server API', () => {
  it.each(['CLI', 'browser'])('registers, lists, and unregisters with %s authentication', async (access) => {
    mocks.auth.mockReturnValue(access === 'CLI');
    mocks.session.mockResolvedValue(access === 'browser');
    const input = { name: 'dev', socketPath: '/known/socket', ignored: 'value' };
    const server = { id: 'server-1', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2' };
    mocks.register.mockResolvedValue(server);
    mocks.list.mockResolvedValue([server]);
    mocks.unregister.mockResolvedValue(true);

    for (const [handler, method, status, body] of [
      [collection, 'POST', 201, server],
      [collection, 'GET', 200, { servers: [server] }],
      [registration, 'DELETE', 200, { deleted: true }],
    ] as const) {
      const req = request(method, input);
      req.headers.cookie = 'session-token=valid';
      const res = response();
      await handler(req, res as unknown as NextApiResponse);
      expect(res.status).toHaveBeenCalledWith(status);
      expect(res.json).toHaveBeenCalledWith(body);
    }
    expect(mocks.register).toHaveBeenCalledWith({ name: 'dev', socketPath: '/known/socket' });
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.unregister).toHaveBeenCalledWith('server-1');
  });

  it('rejects unauthenticated access and unsupported methods', async () => {
    mocks.auth.mockReturnValue(false);
    mocks.session.mockResolvedValue(false);
    for (const [handler, method] of [[collection, 'GET'], [collection, 'POST'], [registration, 'DELETE']] as const) {
      const res = response();
      await handler(request(method), res as unknown as NextApiResponse);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    for (const [handler, method, allow] of [[collection, 'PATCH', 'GET, POST'], [registration, 'GET', 'DELETE']] as const) {
      const res = response();
      await handler(request(method), res as unknown as NextApiResponse);
      expect(res.status).toHaveBeenCalledWith(405);
      expect(res.setHeader).toHaveBeenCalledWith('Allow', allow);
    }
  });

  it('maps validation, missing registration, and storage failures', async () => {
    mocks.register.mockRejectedValue(new ExternalServerError('Invalid socket'));
    let res = response();
    await collection(request('POST'), res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid socket' });

    mocks.unregister.mockResolvedValue(false);
    res = response();
    await registration(request('DELETE'), res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(404);

    mocks.list.mockRejectedValue(new Error('corrupt'));
    res = response();
    await collection(request('GET'), res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
