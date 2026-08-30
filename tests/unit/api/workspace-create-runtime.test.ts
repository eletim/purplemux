import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createWorkspaceRuntime: vi.fn(),
  getWorkspaces: vi.fn(),
  verifyCliToken: vi.fn(),
}));

vi.mock('@/lib/workspace-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/workspace-runtime')>(),
  createWorkspaceRuntime: mocks.createWorkspaceRuntime,
}));
vi.mock('@/lib/workspace-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/workspace-store')>(),
  getWorkspaces: mocks.getWorkspaces,
}));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: mocks.verifyCliToken }));

import cliWorkspacesHandler from '@/pages/api/cli/workspaces';
import uiWorkspaceHandler from '@/pages/api/workspace';

const workspace = {
  id: 'ws-created',
  name: 'Workspace 7',
  directories: ['/absolute/cwd'],
};

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

const request = (overrides: Partial<NextApiRequest>): NextApiRequest => ({
  method: 'POST',
  headers: {},
  query: {},
  body: {},
  ...overrides,
} as NextApiRequest);

describe('workspace creation API entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyCliToken.mockReturnValue(true);
    mocks.createWorkspaceRuntime.mockResolvedValue(workspace);
    mocks.getWorkspaces.mockResolvedValue({ workspaces: [workspace] });
  });

  it('routes Browser UI creation through the shared runtime without changing its response', async () => {
    const res = makeResponse();

    await uiWorkspaceHandler(request({
      body: {
        directory: '/absolute/cwd',
        name: 'UI name',
        resumeSessionId: 'session-1',
        panelType: 'codex-cli',
      },
    }), res);

    expect(mocks.createWorkspaceRuntime).toHaveBeenCalledWith({
      directory: '/absolute/cwd',
      name: 'UI name',
      resumeSessionId: 'session-1',
      panelType: 'codex-cli',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(workspace);
  });

  it('creates a CLI workspace with required cwd and optional name', async () => {
    const res = makeResponse();

    await cliWorkspacesHandler(request({
      body: { cwd: '/absolute/cwd', name: 'CLI name' },
    }), res);

    expect(mocks.createWorkspaceRuntime).toHaveBeenCalledWith({
      directory: '/absolute/cwd',
      name: 'CLI name',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(workspace);
  });

  it('uses existing naming semantics when the optional name is omitted', async () => {
    const res = makeResponse();

    await cliWorkspacesHandler(request({ body: { cwd: '/absolute/cwd' } }), res);

    expect(mocks.createWorkspaceRuntime).toHaveBeenCalledWith({
      directory: '/absolute/cwd',
      name: undefined,
    });
    expect(res.statusCode).toBe(201);
  });

  it.each([
    [{}, 'cwd is required'],
    [{ cwd: 'relative/path' }, 'cwd must be an absolute path'],
  ])('rejects invalid cwd %#', async (body, error) => {
    const res = makeResponse();
    await cliWorkspacesHandler(request({ body }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error });
    expect(mocks.createWorkspaceRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['Directory does not exist', 400],
    ['Please enter a directory path, not a file', 400],
  ])('propagates runtime validation failure: %s', async (message, status) => {
    mocks.createWorkspaceRuntime.mockRejectedValueOnce(new Error(message));
    const res = makeResponse();

    await cliWorkspacesHandler(request({ body: { cwd: '/absolute/cwd' } }), res);

    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ error: message });
  });

  it('rejects unauthenticated mutation before validation or creation', async () => {
    mocks.verifyCliToken.mockReturnValueOnce(false);
    const res = makeResponse();
    await cliWorkspacesHandler(request({ body: { cwd: '/absolute/cwd' } }), res);
    expect(res.statusCode).toBe(403);
    expect(mocks.createWorkspaceRuntime).not.toHaveBeenCalled();
  });

  it('propagates creation failures as server errors', async () => {
    mocks.createWorkspaceRuntime.mockRejectedValueOnce(new Error('tmux failed'));
    const res = makeResponse();
    await cliWorkspacesHandler(request({ body: { cwd: '/absolute/cwd' } }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'tmux failed' });
  });

  it('preserves the existing authenticated GET response', async () => {
    const res = makeResponse();
    await cliWorkspacesHandler(request({ method: 'GET' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ workspaces: [workspace] });
  });
});
