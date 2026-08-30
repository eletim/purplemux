import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTabRuntime: vi.fn(),
  getActiveWorkspaceId: vi.fn(),
  getWorkspaceById: vi.fn(),
}));

vi.mock('@/lib/tab-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tab-runtime')>(),
  createTabRuntime: mocks.createTabRuntime,
}));
vi.mock('@/lib/cli-token', () => ({ verifyCliToken: () => true }));
vi.mock('@/lib/workspace-store', () => ({
  getActiveWorkspaceId: mocks.getActiveWorkspaceId,
  getWorkspaceById: mocks.getWorkspaceById,
  getWorkspaces: vi.fn(),
}));

import uiCreateHandler from '@/pages/api/layout/pane/[paneId]/tabs';
import cliTabsHandler from '@/pages/api/cli/tabs';

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

const runtimeResult = {
  workspace: { id: 'ws-1', name: 'Workspace', directories: ['/cli/cwd'] },
  paneId: 'pane-1',
  tab: {
    id: 'tab-1',
    sessionName: 'session-1',
    name: 'Agent',
    order: 0,
    panelType: 'codex-cli' as const,
  },
  provider: null,
};

describe('tab create API entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveWorkspaceId.mockResolvedValue('ws-1');
    mocks.getWorkspaceById.mockResolvedValue(runtimeResult.workspace);
    mocks.createTabRuntime.mockResolvedValue(runtimeResult);
  });

  it('routes Browser UI create intent through createTabRuntime', async () => {
    const req = {
      method: 'POST',
      query: { paneId: 'pane-1' },
      body: { name: 'UI agent', cwd: '/ui/cwd', panelType: 'codex-cli' },
    } as unknown as NextApiRequest;
    const res = makeResponse();

    await uiCreateHandler(req, res);

    expect(mocks.createTabRuntime).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      paneId: 'pane-1',
      name: 'UI agent',
      cwd: '/ui/cwd',
      panelType: 'codex-cli',
      resumeSessionId: undefined,
    });
    expect(res.statusCode).toBe(200);
  });

  it('routes CLI create through the same runtime and keeps first-directory cwd', async () => {
    const req = {
      method: 'POST',
      headers: {},
      query: {},
      body: { workspaceId: 'ws-1', name: 'CLI agent', panelType: 'codex-cli' },
    } as unknown as NextApiRequest;
    const res = makeResponse();

    await cliTabsHandler(req, res);

    expect(mocks.createTabRuntime).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'CLI agent',
      cwd: '/cli/cwd',
      panelType: 'codex-cli',
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ tabId: 'tab-1', paneId: 'pane-1' }));
  });
});
