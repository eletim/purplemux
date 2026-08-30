import fs from 'fs/promises';
import path from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILayoutData } from '@/types/terminal';

const mocks = vi.hoisted(() => ({
  home: `/tmp/purplemux-layout-close-lock-${process.pid}`,
  createSession: vi.fn(),
  hasSession: vi.fn(),
  killSession: vi.fn(),
}));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: { ...actual, homedir: () => mocks.home },
    homedir: () => mocks.home,
  };
});
vi.mock('@/lib/tmux', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tmux')>(),
  createSession: mocks.createSession,
  hasSession: mocks.hasSession,
  killSession: mocks.killSession,
}));
vi.mock('@/lib/sync-server', () => ({ broadcastSync: vi.fn() }));

import {
  clearLayoutCache,
  removeTabFromPane,
  resolveLayoutFile,
  restartTabSession,
} from '@/lib/layout-store';

const workspaceId = 'ws-close-lock';

const writeLayout = async (layout: ILayoutData) => {
  const file = resolveLayoutFile(workspaceId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(layout));
  clearLayoutCache(workspaceId);
};

describe('removeTabFromPane serialization', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await fs.rm(mocks.home, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(mocks.home, { recursive: true, force: true });
  });

  it('does not let a concurrent restart recreate a session during close', async () => {
    await writeLayout({
      root: {
        type: 'pane',
        id: 'pane-1',
        tabs: [{
          id: 'tab-1',
          sessionName: 'session-tab-1',
          name: 'Terminal',
          order: 0,
          panelType: 'terminal',
        }],
        activeTabId: 'tab-1',
      },
      activePaneId: 'pane-1',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });

    let finishKill!: () => void;
    mocks.killSession.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishKill = resolve;
    }));

    const close = removeTabFromPane(workspaceId, 'pane-1', 'tab-1');
    await vi.waitFor(() => expect(mocks.killSession).toHaveBeenCalledOnce());
    const restart = restartTabSession(workspaceId, 'pane-1', 'tab-1');
    await Promise.resolve();

    expect(mocks.hasSession).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();

    finishKill();
    await expect(close).resolves.toBe(true);
    await expect(restart).resolves.toBe(false);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
