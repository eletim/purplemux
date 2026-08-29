import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IClientTabStatusEntry } from '@/types/status';

const mocks = vi.hoisted(() => ({
  findTab: vi.fn(),
  getForClient: vi.fn(),
  hasSession: vi.fn(),
  getPaneCurrentCommand: vi.fn(),
  readSessionId: vi.fn(),
}));

vi.mock('@/lib/cli-token', () => ({ verifyCliToken: () => true }));
vi.mock('@/lib/cli-utils', () => ({ findTab: mocks.findTab }));
vi.mock('@/lib/status-manager', () => ({
  getStatusManager: () => ({ getForClient: mocks.getForClient }),
}));
vi.mock('@/lib/tmux', () => ({
  hasSession: mocks.hasSession,
  getPaneCurrentCommand: mocks.getPaneCurrentCommand,
}));
vi.mock('@/lib/providers', () => ({
  getProviderByPanelType: () => ({ id: 'codex', readSessionId: mocks.readSessionId }),
}));

import handler from '@/pages/api/cli/tabs/[tabId]/status';

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

const request = () => ({
  method: 'GET',
  headers: {},
  query: { tabId: 'tab-1', workspaceId: 'ws-1' },
} as unknown as NextApiRequest);

const foundTab = {
  workspaceId: 'ws-1',
  paneId: 'pane-1',
  tab: {
    id: 'tab-1',
    sessionName: 'tmux-1',
    name: 'Agent',
    order: 0,
    panelType: 'codex-cli' as const,
    cliState: 'idle' as const,
    agentState: {
      providerId: 'codex',
      sessionId: 'session-persisted',
      jsonlPath: null,
      summary: null,
    },
  },
};

const liveStatus = (overrides: Partial<IClientTabStatusEntry> = {}): IClientTabStatusEntry => ({
  cliState: 'busy',
  workspaceId: 'ws-1',
  tabName: 'Agent',
  panelType: 'codex-cli',
  agentProviderId: 'codex',
  agentSessionId: null,
  currentAction: { toolName: null, summary: 'Thinking' },
  lastAssistantMessage: 'Working',
  lastUserMessage: 'Do work',
  lastEvent: { name: 'prompt-submit', at: 100, seq: 1 },
  eventSeq: 1,
  busySince: 100,
  readyForReviewAt: null,
  permissionRequest: null,
  ...overrides,
});

const callHandler = async () => {
  const res = makeResponse();
  await handler(request(), res);
  return res;
};

describe('CLI tab status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTab.mockResolvedValue(foundTab);
    mocks.getForClient.mockReturnValue(liveStatus());
    mocks.hasSession.mockResolvedValue(true);
    mocks.getPaneCurrentCommand.mockResolvedValue('bash');
    mocks.readSessionId.mockReturnValue('session-persisted');
  });

  it('uses live StatusManager state instead of persisted cliState or the tmux command', async () => {
    const res = await callHandler();

    expect(res.body).toEqual(expect.objectContaining({
      tabId: 'tab-1',
      workspaceId: 'ws-1',
      panelType: 'codex-cli',
      alive: true,
      cliState: 'busy',
      command: 'bash',
      currentCommand: 'bash',
      currentAction: { toolName: null, summary: 'Thinking' },
      lastAssistantMessage: 'Working',
      eventSeq: 1,
    }));
    expect(mocks.readSessionId).not.toHaveBeenCalled();
  });

  it('reflects busy, ready-for-review, and hook session metadata immediately', async () => {
    const busy = await callHandler();
    mocks.getForClient.mockReturnValue(liveStatus({
      cliState: 'ready-for-review',
      agentSessionId: 'session-from-hook',
      busySince: null,
      readyForReviewAt: 200,
      lastEvent: { name: 'stop', at: 200, seq: 2 },
      eventSeq: 2,
    }));
    const ready = await callHandler();

    expect(busy.body).toEqual(expect.objectContaining({ cliState: 'busy', agentSessionId: null }));
    expect(ready.body).toEqual(expect.objectContaining({
      cliState: 'ready-for-review',
      agentSessionId: 'session-from-hook',
      claudeSessionId: 'session-from-hook',
      eventSeq: 2,
    }));
  });

  it('returns live agent state safely when the tmux session is dead', async () => {
    mocks.hasSession.mockResolvedValue(false);
    mocks.getForClient.mockReturnValue(liveStatus({ cliState: 'needs-input' }));

    const res = await callHandler();

    expect(res.body).toEqual(expect.objectContaining({
      alive: false,
      command: null,
      currentCommand: null,
      cliState: 'needs-input',
      agentProviderId: 'codex',
    }));
    expect(mocks.getPaneCurrentCommand).not.toHaveBeenCalled();
  });

  it('falls back to persisted layout and provider metadata only when no live entry exists', async () => {
    mocks.getForClient.mockReturnValue(null);

    const res = await callHandler();

    expect(res.body).toEqual(expect.objectContaining({
      alive: true,
      cliState: 'idle',
      agentProviderId: 'codex',
      agentSessionId: 'session-persisted',
      claudeSessionId: 'session-persisted',
      command: 'bash',
    }));
    expect(mocks.readSessionId).toHaveBeenCalledOnce();
  });

  it('does not use a stale live entry from another workspace', async () => {
    mocks.getForClient.mockReturnValue(liveStatus({ workspaceId: 'ws-other' }));

    const res = await callHandler();

    expect(res.body).toEqual(expect.objectContaining({
      workspaceId: 'ws-1',
      cliState: 'idle',
      agentSessionId: 'session-persisted',
    }));
  });

  it('does not combine a stale provider entry with a newly switched panel type', async () => {
    mocks.getForClient.mockReturnValue(liveStatus({
      panelType: 'claude-code',
      agentProviderId: 'claude',
      agentSessionId: 'stale-claude-session',
    }));

    const res = await callHandler();

    expect(res.body).toEqual(expect.objectContaining({
      panelType: 'codex-cli',
      cliState: 'idle',
      agentProviderId: 'codex',
      agentSessionId: 'session-persisted',
    }));
  });
});
