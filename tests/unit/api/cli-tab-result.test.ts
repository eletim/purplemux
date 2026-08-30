import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readTabAgentResult: vi.fn(),
  findTab: vi.fn(),
  hasSession: vi.fn(),
  capturePaneContent: vi.fn(),
}));

vi.mock('@/lib/cli-token', () => ({ verifyCliToken: () => true }));
vi.mock('@/lib/tab-agent-result', () => ({ readTabAgentResult: mocks.readTabAgentResult }));
vi.mock('@/lib/cli-utils', () => ({ findTab: mocks.findTab }));
vi.mock('@/lib/tmux', () => ({
  hasSession: mocks.hasSession,
  capturePaneContent: mocks.capturePaneContent,
}));

import resultHandler from '@/pages/api/cli/tabs/[tabId]/result';
import captureHandler from '@/pages/api/cli/tabs/[tabId]/capture';

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
}) as unknown as NextApiRequest;

describe('CLI tab result and capture contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes result through the provider-aware structured reader only', async () => {
    const structured = {
      tabId: 'tab-1',
      workspaceId: 'ws-1',
      panelType: 'codex-cli',
      agentProviderId: 'codex',
      agentSessionId: 'session-1',
      status: 'completed',
      reason: null,
      text: 'RESULT_OK',
      completed: true,
      timestamp: 1,
      completionTimestamp: 2,
      interrupted: false,
    };
    mocks.readTabAgentResult.mockResolvedValue(structured);
    const res = makeResponse();

    await resultHandler(request(), res);

    expect(mocks.readTabAgentResult).toHaveBeenCalledWith('ws-1', 'tab-1');
    expect(mocks.capturePaneContent).not.toHaveBeenCalled();
    expect(res.body).toEqual(structured);
  });

  it('keeps terminal pane capture behind an independent endpoint', async () => {
    mocks.findTab.mockResolvedValue({
      workspaceId: 'ws-1',
      paneId: 'pane-1',
      tab: { id: 'tab-1', sessionName: 'tmux-1' },
    });
    mocks.hasSession.mockResolvedValue(true);
    mocks.capturePaneContent.mockResolvedValue('decorated TUI');
    const res = makeResponse();

    await captureHandler(request(), res);

    expect(mocks.capturePaneContent).toHaveBeenCalledWith('tmux-1');
    expect(mocks.readTabAgentResult).not.toHaveBeenCalled();
    expect(res.body).toEqual({ content: 'decorated TUI' });
  });
});
