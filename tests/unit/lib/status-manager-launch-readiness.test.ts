import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITabStatusEntry } from '@/types/status';

const mocks = vi.hoisted(() => ({
  capturePaneAtWidth: vi.fn(),
  getAllPanesInfo: vi.fn(async () => new Map()),
  getChildPids: vi.fn(async () => [222]),
  getSessionPanePid: vi.fn(async () => 111),
  getWorkspaces: vi.fn(async () => ({ workspaces: [] })),
  isAgentRunning: vi.fn(async () => true),
  updateTabCliStatus: vi.fn(async () => undefined),
}));

vi.mock('@/lib/capture-at-width', () => ({
  capturePaneAtWidth: mocks.capturePaneAtWidth,
}));

vi.mock('@/lib/process-utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/process-utils')>(),
  getChildPids: mocks.getChildPids,
}));

vi.mock('@/lib/tmux', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tmux')>(),
  getAllPanesInfo: mocks.getAllPanesInfo,
  getSessionPanePid: mocks.getSessionPanePid,
}));

vi.mock('@/lib/workspace-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/workspace-store')>(),
  getWorkspaces: mocks.getWorkspaces,
}));

vi.mock('@/lib/layout-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/layout-store')>(),
  updateTabCliStatus: mocks.updateTabCliStatus,
}));

vi.mock('@/lib/providers/registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providers/registry')>(),
  getProviderByPanelType: (panelType: string | undefined) => panelType === 'codex-cli'
    ? { id: 'codex', isAgentRunning: mocks.isAgentRunning }
    : null,
}));

import { getStatusManager } from '@/lib/status-manager';

const manager = getStatusManager();
const registeredTabIds: string[] = [];

const entry = (tabId: string): ITabStatusEntry => ({
  cliState: 'inactive',
  workspaceId: `workspace-${tabId}`,
  tabName: tabId,
  tmuxSession: `session-${tabId}`,
  panelType: 'codex-cli',
});

const register = (tabId: string): void => {
  registeredTabIds.push(tabId);
  manager.registerTab(tabId, entry(tabId));
};

describe('StatusManager launch readiness checks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.capturePaneAtWidth.mockResolvedValue('\n› Ask Codex to do anything\n\n  gpt-5.5 high · ~/repo\n');
    mocks.isAgentRunning.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const tabId of registeredTabIds.splice(0)) manager.removeTab(tabId);
    vi.clearAllMocks();
  });

  it('checks only the launched tab even when many other tabs are registered', async () => {
    for (let index = 0; index < 100; index += 1) register(`other-${index}`);
    register('target');

    manager.markAgentLaunch('target');
    await vi.advanceTimersByTimeAsync(700);

    expect(manager.getForClient('target')?.cliState).toBe('idle');
    expect(manager.getForClient('other-0')?.cliState).toBe('inactive');
    expect(mocks.getSessionPanePid).toHaveBeenCalledOnce();
    expect(mocks.getSessionPanePid).toHaveBeenCalledWith('session-target');
    expect(mocks.isAgentRunning).toHaveBeenCalledWith(111, [222]);
    expect(mocks.capturePaneAtWidth).toHaveBeenCalledWith('session-target', 80, 24);
    expect(mocks.getWorkspaces).not.toHaveBeenCalled();
    expect(mocks.getAllPanesInfo).not.toHaveBeenCalled();
  });

  it('keeps inactive fail-safe semantics across all launch retries', async () => {
    mocks.isAgentRunning.mockResolvedValue(false);
    register('target');

    manager.markAgentLaunch('target');
    await vi.advanceTimersByTimeAsync(8_000);

    expect(manager.getForClient('target')?.cliState).toBe('inactive');
    expect(mocks.getSessionPanePid).toHaveBeenCalledTimes(5);
    expect(mocks.isAgentRunning).toHaveBeenCalledTimes(5);
    expect(mocks.capturePaneAtWidth).not.toHaveBeenCalled();
    expect(mocks.getWorkspaces).not.toHaveBeenCalled();
    expect(mocks.getAllPanesInfo).not.toHaveBeenCalled();
  });
});
