import { useRef, useEffect, useMemo } from 'react';
import { Globe, GitCompareArrows, History, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import useTabStore, { selectTabDisplayStatus } from '@/hooks/use-tab-store';
import useUiMode from '@/hooks/use-ui-mode';
import { cn } from '@/lib/utils';
import ProcessIcon from '@/components/icons/process-icon';
import AgentStatusGlyph from '@/components/features/workspace/agent-status-glyph';
import type { TPanelType } from '@/types/terminal';
import type { IWorkspaceChromeSourceAdapter } from '@/types/workspace-chrome';

interface IMobileWorkspaceTabBarProps {
  source: IWorkspaceChromeSourceAdapter;
}

interface ITabDot {
  workspaceId: string;
  workspaceName: string;
  paneId: string;
  tabId: string;
  tabName: string;
  panelType?: TPanelType;
}

const MobileWorkspaceTabBar = ({
  source,
}: IMobileWorkspaceTabBarProps) => {
  const {
    workspaces, activeWorkspaceId, workspaceLayouts,
    activePaneId: selectedPaneId, activeTabId: selectedTabId, capabilities,
  } = source;
  const t = useTranslations('terminal');
  const activeRef = useRef<HTMLButtonElement>(null);
  const statusTabs = useTabStore((s) => s.tabs);
  const showDismissedCompletion = useUiMode((state) => state.mode === 'mulmo');
  const items = useMemo(() => {
    const result: (ITabDot | 'divider')[] = [];

    for (const ws of workspaces) {
      const panes = workspaceLayouts[ws.id] ?? [];
      const wsTabs: ITabDot[] = [];

      for (const pane of panes) {
        const sorted = [...pane.tabs].sort((a, b) => a.order - b.order);
        for (const tab of sorted) {
          wsTabs.push({
            workspaceId: ws.id,
            workspaceName: ws.name,
            paneId: pane.id,
            tabId: tab.id,
            tabName: tab.name || tab.title || tab.sessionName,
            panelType: tab.panelType,
          });
        }
      }

      if (wsTabs.length > 0) {
        if (result.length > 0) result.push('divider');
        result.push(...wsTabs);
      }
    }

    return result;
  }, [workspaces, workspaceLayouts]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selectedTabId]);

  const totalTabs = items.filter((i) => i !== 'divider').length;
  const activeWorkspaceHasTabs = activeWorkspaceId
    ? (workspaceLayouts[activeWorkspaceId] ?? []).some((pane) => pane.tabs.length > 0)
    : false;
  const showCreateTab = capabilities.createTab && !!activeWorkspaceId && !activeWorkspaceHasTabs;
  if (totalTabs === 0 && !showCreateTab) return null;

  return (
    <div className="shrink-0 border-t bg-background" data-ui-chrome="tab-bar">
      <div
        className="flex h-10 items-center justify-center overflow-x-auto px-4"
        style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        {items.map((item, i) => {
          if (item === 'divider') {
            return (
              <span
                key={`d-${i}`}
                className="mx-0.5 h-3 w-px shrink-0 bg-border"
              />
            );
          }

          const isActive =
            item.workspaceId === activeWorkspaceId &&
            item.paneId === selectedPaneId &&
            item.tabId === selectedTabId;
          const isAgent = item.panelType === 'claude-code' || item.panelType === 'codex-cli';
          const status = capabilities.agentControls
            ? selectTabDisplayStatus(statusTabs, item.tabId, showDismissedCompletion)
            : 'idle';
          const termStatus = statusTabs[item.tabId]?.terminalStatus;
          const currentProcess = statusTabs[item.tabId]?.currentProcess;
          const statusLabel = status === 'busy'
            ? t('statusBusy')
            : status === 'needs-input'
              ? t('statusNeedsInput')
              : status === 'ready-for-review'
                ? t('statusNeedsReview')
                : status === 'completed'
                  ? t('installDone')
                  : status === 'unknown'
                    ? '?'
                    : termStatus ?? 'idle';
          const tabName = item.tabName || statusTabs[item.tabId]?.tabName || item.tabId;
          const iconColorClass = termStatus === 'server'
            ? 'text-ui-green'
            : termStatus === 'running'
              ? 'text-ui-blue'
              : 'text-muted-foreground/50';

          return (
            <button
              key={item.tabId}
              ref={isActive ? activeRef : undefined}
              className="flex h-8 w-8 shrink-0 items-center justify-center"
              onClick={() => source.selectTab(item.workspaceId, item.paneId, item.tabId)}
              aria-current={isActive ? 'true' : undefined}
              aria-label={`${item.workspaceName}, ${tabName}, ${statusLabel}`}
              data-ui-selection="pill"
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full',
                  isActive && 'bg-foreground/15',
                )}
              >
                {capabilities.agentControls && isAgent ? (
                  <AgentStatusGlyph status={status} compact showIdle />
                ) : item.panelType === 'web-browser' ? (
                  <Globe className="h-2.5 w-2.5 text-muted-foreground/50" />
                ) : item.panelType === 'diff' ? (
                  <GitCompareArrows className="h-2.5 w-2.5 text-muted-foreground/50" />
                ) : item.panelType === 'agent-sessions' ? (
                  <History className="h-2.5 w-2.5 text-muted-foreground/50" />
                ) : (
                  <ProcessIcon process={currentProcess} className={cn('h-3 w-3', iconColorClass)} />
                )}
              </span>
            </button>
          );
        })}
        {showCreateTab && (
          <button
            className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => { if (activeWorkspaceId) void source.createTab?.(activeWorkspaceId); }}
            disabled={source.isCreatingTab}
            aria-label={t('newTabLabel')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </div>
  );
};

export default MobileWorkspaceTabBar;
