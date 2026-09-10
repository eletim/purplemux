// @vitest-environment jsdom

import { createElement, Fragment } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileWorkspaceTabBar from '@/components/features/mobile/mobile-workspace-tab-bar';
import MobileTerminalPage from '@/components/features/mobile/mobile-terminal-page';
import { NotificationPanel, useNotificationCount } from '@/components/features/workspace/notification-sheet';
import useTabStore, { selectTabDisplayStatus } from '@/hooks/use-tab-store';
import useAgentStatus from '@/hooks/use-agent-status';
import useUiMode from '@/hooks/use-ui-mode';
import { useLayoutStore } from '@/hooks/use-layout';
import useSessionHistoryStore from '@/hooks/use-session-history-store';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import type { IPaneNode, IWorkspace } from '@/types/terminal';

dayjs.extend(relativeTime);

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { count?: number }) => {
    const labels: Record<string, string> = {
      statusBusy: 'Processing',
      statusNeedsInput: 'Waiting for input',
      statusNeedsReview: 'Needs review',
      installDone: 'Done',
      dismiss: 'Dismiss',
      reviewSection: `Needs review (${values?.count ?? 0})`,
      empty: 'Empty',
    };
    return labels[key] ?? key;
  },
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/' }),
  default: { push: vi.fn() },
}));

vi.mock('@/hooks/use-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-layout')>();
  return {
    ...actual,
    default: () => actual.useLayoutStore(),
  };
});

vi.mock('@/hooks/use-auto-delete-empty-workspace', () => ({
  useAutoDeleteEmptyWorkspace: vi.fn(),
}));

vi.mock('@/hooks/use-agent-install-check', () => ({
  useAgentInstallCheck: () => ({ ensureAgentInstalled: vi.fn(), installDialogs: null }),
}));

vi.mock('@/components/features/mobile/mobile-tab-header', () => ({ default: () => null }));
vi.mock('@/components/features/mobile/mobile-surface-view', () => ({ default: () => null }));
vi.mock('@/components/features/mobile/mobile-new-tab-dialog', () => ({ default: () => null }));
vi.mock('@/components/features/mobile/mobile-git-fullscreen', () => ({ default: () => null }));

vi.mock('motion/react', async () => {
  const React = await import('react');
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        React.createElement('div', props, children)
      ),
    },
  };
});

const workspace: IWorkspace = {
  id: 'workspace-1',
  name: 'Workspace One',
  directories: ['/tmp/workspace-one'],
};

const panes: IPaneNode[] = [{
  type: 'pane',
  id: 'pane-1',
  activeTabId: 'agent-tab',
  tabs: [
    { id: 'agent-tab', sessionName: 'agent-session', name: 'Agent One', order: 0, panelType: 'claude-code' },
    { id: 'shell-tab', sessionName: 'shell-session', name: 'Shell One', order: 1, panelType: 'terminal' },
  ],
}];

const NotificationCounts = () => {
  const { busyCount, attentionCount } = useNotificationCount();
  return createElement('output', { 'aria-label': 'notification counts' }, `${busyCount}:${attentionCount}`);
};

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
}

const AgentStatusConnection = () => {
  useAgentStatus();
  return null;
};

describe('status surface integration', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    Element.prototype.scrollIntoView = vi.fn();
    useUiMode.setState({ mode: 'mulmo', hydrated: true });
    useTabStore.setState({ tabs: {}, tabOrders: {}, statusWsConnected: true });
    useSessionHistoryStore.setState({ entries: [] });
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      isLoading: false,
      error: null,
    });
    useLayoutStore.setState({
      workspaceId: workspace.id,
      layout: {
        root: panes[0],
        activePaneId: 'pane-1',
        updatedAt: 'test',
      },
      paneCount: 1,
      canSplit: true,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('names every mobile tab button with its workspace, tab, and status', async () => {
    useTabStore.getState().initTab('agent-tab', {
      workspaceId: workspace.id,
      panelType: 'claude-code',
      cliState: 'ready-for-review',
    });
    useTabStore.getState().initTab('shell-tab', {
      workspaceId: workspace.id,
      panelType: 'terminal',
      cliState: 'idle',
      terminalStatus: 'running',
    });
    const onSelect = vi.fn();

    render(createElement(MobileWorkspaceTabBar, {
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      workspaceLayouts: { [workspace.id]: panes },
      selectedPaneId: 'pane-1',
      selectedTabId: 'agent-tab',
      onSelect,
    }));

    const agentButton = screen.getByRole('button', {
      name: 'Workspace One, Agent One, Needs review',
    });
    expect(agentButton.getAttribute('aria-current')).toBe('true');
    expect(agentButton.querySelector('[role="status"]')).toBeNull();
    expect(agentButton.querySelector('[role="img"][aria-label="Needs review"]')).not.toBeNull();
    expect(screen.getByRole('button', {
      name: 'Workspace One, Shell One, running',
    })).toBeDefined();

    fireEvent.click(agentButton);
    expect(onSelect).toHaveBeenCalledWith(workspace.id, 'pane-1', 'agent-tab');
  });

  it.each([
    ['default', 'idle'],
    ['mulmo', 'Done'],
  ] as const)('automatically acknowledges the active completion in %s mode', async (mode, visibleStatus) => {
    useUiMode.setState({ mode });
    useTabStore.getState().initTab('agent-tab', {
      workspaceId: workspace.id,
      panelType: 'claude-code',
      cliState: 'ready-for-review',
      readyForReviewAt: Date.now(),
    });

    render(createElement(Fragment, null,
      createElement(AgentStatusConnection),
      createElement(NotificationCounts),
      createElement(MobileTerminalPage),
      createElement(MobileWorkspaceTabBar, {
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        workspaceLayouts: { [workspace.id]: panes },
        selectedPaneId: 'pane-1',
        selectedTabId: 'agent-tab',
        onSelect: vi.fn(),
      }),
    ));

    expect(FakeWebSocket.instances).toHaveLength(1);
    await waitFor(() => expect(screen.getByLabelText('notification counts').textContent).toBe('0:0'));
    const dismissed = useTabStore.getState().tabs['agent-tab'];
    expect(dismissed.cliState).toBe('idle');
    expect(dismissed.dismissedAt).toEqual(expect.any(Number));
    expect(FakeWebSocket.instances[0].send).toHaveBeenCalledWith(JSON.stringify({
      type: 'status:tab-dismissed',
      tabId: 'agent-tab',
    }));
    expect(selectTabDisplayStatus(useTabStore.getState().tabs, 'agent-tab')).toBe('idle');
    expect(selectTabDisplayStatus(useTabStore.getState().tabs, 'agent-tab', true)).toBe('completed');
    const statusButton = screen.getByRole('button', {
      name: `Workspace One, Agent One, ${visibleStatus}`,
    });
    expect(statusButton.querySelector(`[data-agent-status="${mode === 'mulmo' ? 'completed' : 'idle'}"]`))
      .not.toBeNull();
    expect(useTabStore.getState().tabs['agent-tab']).toMatchObject({
      cliState: 'idle',
      dismissedAt: dismissed.dismissedAt,
    });
  });

  it.each([false, true])(
    'keeps the active-session Dismiss control hidden in Default mode (history: %s)',
    (withHistory) => {
      useUiMode.setState({ mode: 'default' });
      useTabStore.getState().initTab('agent-tab', {
        workspaceId: workspace.id,
        panelType: 'claude-code',
        cliState: 'ready-for-review',
        readyForReviewAt: Date.now(),
        agentProviderId: 'claude',
        agentSessionId: withHistory ? 'session-1' : null,
      });
      if (withHistory) {
        useSessionHistoryStore.setState({
          entries: [{
            id: 'history-1',
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            workspaceDir: workspace.directories[0],
            tabId: 'agent-tab',
            providerId: 'claude',
            agentSessionId: 'session-1',
            prompt: 'prompt',
            result: 'result',
            startedAt: Date.now() - 1000,
            completedAt: Date.now(),
            duration: 1000,
            dismissedAt: null,
            toolUsage: {},
            touchedFiles: [],
          }],
        });
      }

      render(createElement(NotificationPanel));

      expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    },
  );
});
