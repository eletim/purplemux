import { afterEach, describe, expect, it } from 'vitest';
import '@/lib/providers';
import { getStatusManager } from '@/lib/status-manager';
import type { ITabStatusEntry } from '@/types/status';

const tabId = 'tab-client-read-test';
const manager = getStatusManager();

const entry = (): ITabStatusEntry => ({
  cliState: 'busy',
  workspaceId: 'ws-1',
  tabName: 'Agent',
  tmuxSession: 'session-private',
  panelType: 'codex-cli',
  agentProviderId: 'codex',
  agentSessionId: 'session-live',
  jsonlPath: '/private/session.jsonl',
  processRetries: 2,
  lastResumeOrStartedAt: 123,
  currentAction: { toolName: null, summary: 'Thinking' },
  lastAssistantMessage: 'Working',
  lastUserMessage: 'Do work',
  lastEvent: { name: 'prompt-submit', at: 456, seq: 7 },
  eventSeq: 7,
  busySince: 456,
  readyForReviewAt: null,
});

describe('StatusManager client reads', () => {
  afterEach(() => manager.removeTab(tabId));

  it('returns the WebSocket client-safe DTO for one tab', () => {
    manager.registerTab(tabId, entry());

    const status = manager.getForClient(tabId);

    expect(status).toEqual(manager.getAllForClient()[tabId]);
    expect(status).toEqual(expect.objectContaining({
      cliState: 'busy',
      workspaceId: 'ws-1',
      agentSessionId: 'session-live',
      currentAction: { toolName: null, summary: 'Thinking' },
      eventSeq: 7,
    }));
    expect(status).not.toHaveProperty('tmuxSession');
    expect(status).not.toHaveProperty('jsonlPath');
    expect(status).not.toHaveProperty('processRetries');
    expect(status).not.toHaveProperty('lastResumeOrStartedAt');
  });

  it('returns a detached DTO and null for an unknown tab', () => {
    manager.registerTab(tabId, entry());
    const status = manager.getForClient(tabId);
    if (!status) throw new Error('expected status');

    status.cliState = 'idle';

    expect(manager.getForClient(tabId)?.cliState).toBe('busy');
    expect(manager.getForClient('missing-tab')).toBeNull();
  });

  it('exposes hook-updated session metadata immediately', () => {
    manager.registerTab(tabId, entry());

    manager.applyAgentHookMeta('codex', 'session-private', { sessionId: 'session-from-hook' });

    expect(manager.getForClient(tabId)?.agentSessionId).toBe('session-from-hook');
  });

  it('synchronizes provider session persistence into the live entry', () => {
    manager.registerTab(tabId, entry());

    manager.syncAgentSessionId('session-private', 'codex', 'session-from-watcher');

    expect(manager.getForClient(tabId)?.agentSessionId).toBe('session-from-watcher');
    manager.syncAgentSessionId('session-private', 'claude', 'wrong-provider-session');
    expect(manager.getForClient(tabId)?.agentSessionId).toBe('session-from-watcher');
  });
});
