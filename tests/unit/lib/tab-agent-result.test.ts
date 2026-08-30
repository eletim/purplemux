import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readTabAgentResult,
  type ITabAgentResultDependencies,
} from '@/lib/tab-agent-result';
import { readProviderTimelineUntil } from '@/lib/provider-timeline-reader';
import { codexProvider } from '@/lib/providers/codex';
import { claudeProvider } from '@/lib/providers/claude';
import type { IAgentProvider } from '@/lib/providers';
import type { ITab, TPanelType } from '@/types/terminal';
import type { IClientTabStatusEntry } from '@/types/status';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const makeJsonl = async (lines: unknown[], filename = 'session.jsonl'): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-agent-result-'));
  tempDirs.push(dir);
  const jsonlPath = path.join(dir, filename);
  await fs.writeFile(jsonlPath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return jsonlPath;
};

const codexLine = (type: string, timestamp: string, payload: Record<string, unknown> = {}) => ({
  timestamp,
  type: 'event_msg',
  payload: { type, ...payload },
});

const claudeAssistant = (text: string, timestamp: string, stopReason = 'end_turn') => ({
  type: 'assistant',
  timestamp,
  message: {
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
  },
});

const makeTab = (
  panelType: TPanelType,
  provider: IAgentProvider | null,
  sessionId: string | null,
  jsonlPath: string | null,
): ITab => ({
  id: 'tab-1',
  sessionName: 'tmux-1',
  name: 'Agent',
  order: 0,
  panelType,
  ...(provider ? {
    agentState: {
      providerId: provider.id,
      sessionId,
      jsonlPath,
      summary: null,
    },
  } : {}),
});

const makeDependencies = (
  tab: ITab,
  provider: IAgentProvider | null,
  overrides: Partial<ITabAgentResultDependencies> = {},
): ITabAgentResultDependencies => ({
  findTab: vi.fn(async () => ({ workspaceId: 'ws-1', paneId: 'pane-1', tab })),
  getLiveStatus: vi.fn(() => null),
  getProvider: vi.fn((providerId) => provider?.id === providerId ? provider : null),
  getProviderByPanelType: vi.fn(() => provider),
  getSessionPanePid: vi.fn(async () => null),
  existsSync: vi.fn(() => true),
  isAllowedJsonlPath: vi.fn(() => true),
  readProviderTimelineUntil,
  resolveProviderJsonlPath: vi.fn(async () => null),
  ...overrides,
});

const liveStatus = (
  overrides: Partial<IClientTabStatusEntry> = {},
): IClientTabStatusEntry => ({
  cliState: 'ready-for-review',
  workspaceId: 'ws-1',
  tabName: 'Agent',
  panelType: 'codex-cli',
  agentProviderId: 'codex',
  agentSessionId: 'session-live',
  ...overrides,
});

describe('readTabAgentResult', () => {
  it('prefers a matching live StatusManager identity while persisted metadata is null', async () => {
    const jsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T00:00:00.000Z', { message: 'LIVE_OK' }),
      codexLine('task_complete', '2026-08-29T00:00:01.000Z'),
    ]);
    const tab = makeTab('codex-cli', codexProvider, null, null);
    const dependencies = makeDependencies(tab, codexProvider, {
      getLiveStatus: vi.fn(() => liveStatus()),
      resolveProviderJsonlPath: vi.fn(async (_provider, _sessionName, sessionId) =>
        sessionId === 'session-live' ? jsonlPath : null),
    });

    const result = await readTabAgentResult('ws-1', 'tab-1', dependencies);

    expect(result).toMatchObject({
      agentProviderId: 'codex',
      agentSessionId: 'session-live',
      status: 'completed',
      text: 'LIVE_OK',
    });
    expect(dependencies.getSessionPanePid).not.toHaveBeenCalled();
  });

  it('prefers the live session when live and persisted identities differ', async () => {
    const liveJsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T00:01:00.000Z', { message: 'NEW_OK' }),
      codexLine('task_complete', '2026-08-29T00:01:01.000Z'),
    ]);
    const staleJsonlPath = await makeJsonl([], 'rollout-old-session.jsonl');
    const tab = makeTab('codex-cli', codexProvider, 'old-session', staleJsonlPath);
    const dependencies = makeDependencies(tab, codexProvider, {
      getLiveStatus: vi.fn(() => liveStatus()),
      resolveProviderJsonlPath: vi.fn(async (_provider, _sessionName, sessionId) =>
        sessionId === 'session-live' ? liveJsonlPath : null),
    });

    const result = await readTabAgentResult('ws-1', 'tab-1', dependencies);

    expect(result).toMatchObject({
      agentSessionId: 'session-live',
      status: 'completed',
      text: 'NEW_OK',
    });
  });

  it.each([
    ['workspace mismatch', liveStatus({ workspaceId: 'ws-other' })],
    ['panel type mismatch', liveStatus({ panelType: 'claude-code' })],
    ['provider mismatch', liveStatus({ agentProviderId: 'claude' })],
  ])('ignores a live entry with %s and uses persisted recovery metadata', async (_label, status) => {
    const jsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T00:02:00.000Z', { message: 'PERSISTED_OK' }),
      codexLine('task_complete', '2026-08-29T00:02:01.000Z'),
    ]);
    const tab = makeTab('codex-cli', codexProvider, 'session-persisted', jsonlPath);
    const dependencies = makeDependencies(tab, codexProvider, {
      getLiveStatus: vi.fn(() => status),
      getProvider: vi.fn((providerId) => providerId === 'codex' ? codexProvider : claudeProvider),
    });

    const result = await readTabAgentResult('ws-1', 'tab-1', dependencies);

    expect(result).toMatchObject({
      agentProviderId: 'codex',
      agentSessionId: 'session-persisted',
      status: 'completed',
      text: 'PERSISTED_OK',
    });
  });

  it('does not recover a stale persisted session when a matching live entry has no session ID', async () => {
    const tab = makeTab('codex-cli', codexProvider, 'session-persisted', null);
    const dependencies = makeDependencies(tab, codexProvider, {
      getLiveStatus: vi.fn(() => liveStatus({ agentSessionId: null })),
    });

    const result = await readTabAgentResult('ws-1', 'tab-1', dependencies);

    expect(result).toMatchObject({
      agentProviderId: 'codex',
      agentSessionId: null,
      status: 'not-ready',
      reason: 'agent-session-id-unavailable',
    });
  });

  it('returns the latest completed Codex response through the Codex timeline parser', async () => {
    const jsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T01:00:00.000Z', { message: 'older' }),
      codexLine('task_complete', '2026-08-29T01:00:01.000Z'),
      codexLine('agent_message', '2026-08-29T01:01:00.000Z', { message: 'RESULT_OK' }),
      codexLine('task_complete', '2026-08-29T01:01:01.000Z'),
    ]);
    const tab = makeTab('codex-cli', codexProvider, 'codex-session', jsonlPath);

    const result = await readTabAgentResult('ws-1', 'tab-1', makeDependencies(tab, codexProvider));

    expect(result).toMatchObject({
      agentProviderId: 'codex',
      agentSessionId: 'codex-session',
      status: 'completed',
      text: 'RESULT_OK',
      completed: true,
      interrupted: false,
    });
  });

  it('returns a Claude text block through the Claude timeline parser', async () => {
    const jsonlPath = await makeJsonl([
      claudeAssistant('CLAUDE_OK', '2026-08-29T02:00:00.000Z'),
    ]);
    const tab = makeTab('claude-code', claudeProvider, 'session', jsonlPath);

    const result = await readTabAgentResult('ws-1', 'tab-1', makeDependencies(tab, claudeProvider));

    expect(result).toMatchObject({
      agentProviderId: 'claude',
      status: 'completed',
      text: 'CLAUDE_OK',
      completed: true,
    });
  });

  it('returns not-ready when the assistant response has not completed', async () => {
    const jsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T03:00:00.000Z', { message: 'partial' }),
    ]);
    const tab = makeTab('codex-cli', codexProvider, 'codex-session', jsonlPath);

    const result = await readTabAgentResult('ws-1', 'tab-1', makeDependencies(tab, codexProvider));

    expect(result).toMatchObject({
      status: 'not-ready',
      reason: 'assistant-response-unavailable',
      text: null,
      completed: false,
    });
  });

  it('returns not-ready before the agent session ID is known', async () => {
    const tab = makeTab('codex-cli', codexProvider, null, null);

    const result = await readTabAgentResult('ws-1', 'tab-1', makeDependencies(tab, codexProvider));

    expect(result).toMatchObject({
      status: 'not-ready',
      reason: 'agent-session-id-unavailable',
      agentSessionId: null,
    });
  });

  it('returns not-ready when the provider JSONL has not been created', async () => {
    const tab = makeTab('codex-cli', codexProvider, 'codex-session', null);
    const dependencies = makeDependencies(tab, codexProvider, {
      existsSync: vi.fn(() => false),
      resolveProviderJsonlPath: vi.fn(async () => '/missing/session.jsonl'),
    });

    const result = await readTabAgentResult('ws-1', 'tab-1', dependencies);

    expect(result).toMatchObject({
      status: 'not-ready',
      reason: 'jsonl-unavailable',
      agentSessionId: 'codex-session',
    });
  });

  it('reads persisted JSONL after the tmux session is dead', async () => {
    const jsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T04:00:00.000Z', { message: 'still readable' }),
      codexLine('task_complete', '2026-08-29T04:00:01.000Z'),
    ]);
    const tab = makeTab('codex-cli', codexProvider, 'codex-session', jsonlPath);
    const dependencies = makeDependencies(tab, codexProvider);

    const result = await readTabAgentResult('ws-1', 'tab-1', dependencies);

    expect(result).toMatchObject({ status: 'completed', text: 'still readable' });
    expect(dependencies.getSessionPanePid).toHaveBeenCalledWith('tmux-1');
  });

  it('does not combine a newly detected session ID with persisted JSONL', async () => {
    const oldJsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T04:10:00.000Z', { message: 'old response' }),
      codexLine('task_complete', '2026-08-29T04:10:01.000Z'),
    ]);
    const tab = makeTab('codex-cli', codexProvider, 'old-session', oldJsonlPath);
    const provider = {
      ...codexProvider,
      detectActiveSession: vi.fn(async () => ({
        status: 'running' as const,
        sessionId: 'new-session',
        jsonlPath: null,
        pid: 123,
        startedAt: Date.now(),
        cwd: '/workspace',
      })),
    };
    const dependencies = makeDependencies(tab, provider, {
      getSessionPanePid: vi.fn(async () => 123),
      resolveProviderJsonlPath: vi.fn(async () => null),
    });

    const result = await readTabAgentResult('ws-1', 'tab-1', dependencies);

    expect(result).toMatchObject({
      status: 'not-ready',
      reason: 'jsonl-unavailable',
      agentSessionId: 'new-session',
      text: null,
    });
  });

  it('does not combine mismatched persisted session and JSONL metadata for a dead tab', async () => {
    const oldSessionId = '11111111-1111-4111-8111-111111111111';
    const newSessionId = '22222222-2222-4222-8222-222222222222';
    const oldJsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T04:15:00.000Z', { message: 'old response' }),
      codexLine('task_complete', '2026-08-29T04:15:01.000Z'),
    ], `rollout-${oldSessionId}.jsonl`);
    const tab = makeTab('codex-cli', codexProvider, newSessionId, oldJsonlPath);
    const dependencies = makeDependencies(tab, codexProvider, {
      resolveProviderJsonlPath: vi.fn(async () => null),
    });

    const result = await readTabAgentResult('ws-1', 'tab-1', dependencies);

    expect(result).toMatchObject({
      status: 'not-ready',
      reason: 'jsonl-unavailable',
      agentSessionId: newSessionId,
      text: null,
    });
  });

  it('does not return persisted results while a live agent session is unresolved', async () => {
    const oldJsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T04:20:00.000Z', { message: 'old response' }),
      codexLine('task_complete', '2026-08-29T04:20:01.000Z'),
    ]);
    const tab = makeTab('codex-cli', codexProvider, 'old-session', oldJsonlPath);
    const provider = {
      ...codexProvider,
      detectActiveSession: vi.fn(async () => ({
        status: 'not-running' as const,
        sessionId: null,
        jsonlPath: null,
        pid: null,
        startedAt: null,
        cwd: null,
      })),
      isAgentRunning: vi.fn(async () => true),
    };
    const dependencies = makeDependencies(tab, provider, {
      getSessionPanePid: vi.fn(async () => 123),
    });

    const result = await readTabAgentResult('ws-1', 'tab-1', dependencies);

    expect(result).toMatchObject({
      status: 'not-ready',
      reason: 'agent-session-id-unavailable',
      agentSessionId: null,
      text: null,
    });
  });

  it('reports non-agent terminal tabs as not applicable', async () => {
    const tab = makeTab('terminal', null, null, null);

    const result = await readTabAgentResult('ws-1', 'tab-1', makeDependencies(tab, null));

    expect(result).toMatchObject({
      status: 'not-applicable',
      reason: 'non-agent-tab',
      agentProviderId: null,
    });
  });

  it('does not return an assistant fragment from an interrupted turn', async () => {
    const jsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T05:00:00.000Z', { message: 'partial' }),
      codexLine('turn_aborted', '2026-08-29T05:00:01.000Z'),
    ]);
    const tab = makeTab('codex-cli', codexProvider, 'codex-session', jsonlPath);

    const result = await readTabAgentResult('ws-1', 'tab-1', makeDependencies(tab, codexProvider));

    expect(result).toMatchObject({
      status: 'interrupted',
      reason: 'turn-interrupted',
      text: null,
      completed: false,
      interrupted: true,
    });
  });

  it('keeps the previous completed response when the latest turn is interrupted', async () => {
    const jsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T06:00:00.000Z', { message: 'previous' }),
      codexLine('task_complete', '2026-08-29T06:00:01.000Z'),
      codexLine('user_message', '2026-08-29T06:01:00.000Z', { message: 'next' }),
      codexLine('agent_message', '2026-08-29T06:01:01.000Z', { message: 'partial' }),
      codexLine('turn_aborted', '2026-08-29T06:01:02.000Z'),
    ]);
    const tab = makeTab('codex-cli', codexProvider, 'codex-session', jsonlPath);

    const result = await readTabAgentResult('ws-1', 'tab-1', makeDependencies(tab, codexProvider));

    expect(result).toMatchObject({
      status: 'completed',
      text: 'previous',
      completed: true,
      interrupted: true,
    });
  });

  it('pages backward to preserve a completion before a long interrupted turn', async () => {
    const jsonlPath = await makeJsonl([
      codexLine('agent_message', '2026-08-29T07:00:00.000Z', { message: 'previous' }),
      codexLine('task_complete', '2026-08-29T07:00:01.000Z'),
      codexLine('user_message', '2026-08-29T07:01:00.000Z', { message: 'next' }),
      ...Array.from({ length: 600 }, (_, index) => codexLine(
        'plan_update',
        `2026-08-29T07:${String(2 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        { plan: [{ id: `task-${index}`, status: 'in_progress', description: `step ${index}` }] },
      )),
      codexLine('turn_aborted', '2026-08-29T07:20:00.000Z'),
    ]);
    const tab = makeTab('codex-cli', codexProvider, 'session', jsonlPath);

    const result = await readTabAgentResult('ws-1', 'tab-1', makeDependencies(tab, codexProvider));

    expect(result).toMatchObject({
      status: 'completed',
      text: 'previous',
      completed: true,
      interrupted: true,
    });
  });
});
