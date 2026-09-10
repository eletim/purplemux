// @vitest-environment jsdom

import { createElement, Fragment } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileWorkspaceTabBar from '@/components/features/mobile/mobile-workspace-tab-bar';
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
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id });
    useLayoutStore.setState({
      workspaceId: workspace.id,
      layout: {
        root: panes[0],
        activePaneId: 'pane-1',
        updatedAt: 'test',
      },
      paneCount: 1,
      canSplit: true,
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
    expect(screen.getByRole('button', {
      name: 'Workspace One, Shell One, running',
    })).toBeDefined();

    fireEvent.click(agentButton);
    expect(onSelect).toHaveBeenCalledWith(workspace.id, 'pane-1', 'agent-tab');
  });

  it('acknowledges an active completion and keeps only the Mulmo history cue', async () => {
    useTabStore.getState().initTab('agent-tab', {
      workspaceId: workspace.id,
      panelType: 'claude-code',
      cliState: 'ready-for-review',
      readyForReviewAt: Date.now(),
    });

    render(createElement(Fragment, null,
      createElement(AgentStatusConnection),
      createElement(NotificationCounts),
      createElement(NotificationPanel),
      createElement(MobileWorkspaceTabBar, {
        workspaces: [workspace],
        activeWorkspaceId: workspace.id,
        workspaceLayouts: { [workspace.id]: panes },
        selectedPaneId: 'pane-1',
        selectedTabId: 'agent-tab',
        onSelect: vi.fn(),
      }),
    ));

    expect(screen.getByLabelText('notification counts').textContent).toBe('0:1');
    expect(FakeWebSocket.instances).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

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
    expect(screen.getByRole('button', {
      name: 'Workspace One, Agent One, Done',
    }).querySelector('[data-agent-status="completed"]')).not.toBeNull();

    act(() => useUiMode.setState({ mode: 'default' }));

    expect(screen.getByRole('button', {
      name: 'Workspace One, Agent One, idle',
    })).toBeDefined();
    expect(useTabStore.getState().tabs['agent-tab']).toMatchObject({
      cliState: 'idle',
      dismissedAt: dismissed.dismissedAt,
    });
  });
});
