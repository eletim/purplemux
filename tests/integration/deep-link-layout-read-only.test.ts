import fs from 'fs/promises';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  home: `/tmp/purplemux-read-only-layout-${process.pid}`,
}));

const createSession = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => testState.home,
    default: { ...actual, homedir: () => testState.home },
  };
});

vi.mock('@/lib/tmux', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tmux')>();
  return { ...actual, createSession };
});

import handler from '@/pages/api/layout';

const responseCapture = (): NextApiResponse => {
  const response = {
    status: vi.fn(() => response),
    json: vi.fn(() => response),
  } as unknown as NextApiResponse;
  return response;
};

const request = (workspaceId: string): NextApiRequest => ({
  method: 'GET',
  query: { workspace: workspaceId, readOnly: 'true' },
} as unknown as NextApiRequest);

describe('deep-link layout retrieval', () => {
  const workspaceId = 'ws-readonly';
  const base = path.join(testState.home, '.purplemux');
  const workspaceDir = path.join(base, 'workspaces', workspaceId);
  const layoutFile = path.join(workspaceDir, 'layout.json');
  const backupFile = path.join(workspaceDir, 'layout.json.bak');

  beforeEach(async () => {
    createSession.mockClear();
    await fs.rm(testState.home, { recursive: true, force: true });
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(base, 'workspaces.json'), JSON.stringify({
      workspaces: [{ id: workspaceId, name: 'Read only', directories: [testState.home] }],
      groups: [],
      activeWorkspaceId: workspaceId,
      sidebarCollapsed: false,
      sidebarWidth: 240,
      updatedAt: '2026-09-11T00:00:00.000Z',
    }));
  });

  afterEach(async () => {
    await fs.rm(testState.home, { recursive: true, force: true });
  });

  it('does not create layout, tab, backup, or tmux resources for unavailable layout state', async () => {
    const missingResponse = responseCapture();
    await handler(request(workspaceId), missingResponse);

    expect(missingResponse.status).toHaveBeenCalledWith(200);
    expect(missingResponse.json).toHaveBeenCalledWith(null);
    await expect(fs.access(layoutFile)).rejects.toThrow();
    expect(await fs.readdir(workspaceDir)).toEqual([]);
    expect(createSession).not.toHaveBeenCalled();

    await fs.writeFile(layoutFile, '{not valid json');
    const corruptResponse = responseCapture();
    await handler(request(workspaceId), corruptResponse);

    expect(corruptResponse.status).toHaveBeenCalledWith(200);
    expect(corruptResponse.json).toHaveBeenCalledWith(null);
    expect(await fs.readFile(layoutFile, 'utf8')).toBe('{not valid json');
    await expect(fs.access(backupFile)).rejects.toThrow();
    expect(createSession).not.toHaveBeenCalled();
  });
});
