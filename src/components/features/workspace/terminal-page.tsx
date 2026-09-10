import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RefreshCw, Plus } from 'lucide-react';
import { Group, Panel, Separator, type GroupImperativeHandle } from 'react-resizable-panels';
import Spinner from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import useLayout, { collectPanes } from '@/hooks/use-layout';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import useKeyboardShortcuts from '@/hooks/use-keyboard-shortcuts';
import useTabMetadataStore from '@/hooks/use-tab-metadata-store';
import type { ITabMetadata } from '@/hooks/use-tab-metadata-store';
import { requestSync } from '@/hooks/use-agent-status';
import PaneLayout from '@/components/features/workspace/pane-layout';
import ContentHeader from '@/components/features/workspace/content-header';
import GitSidePanel from '@/components/features/workspace/git-side-panel';
import useSidebarActions from '@/hooks/use-sidebar-actions';
import { useAutoDeleteEmptyWorkspace } from '@/hooks/use-auto-delete-empty-workspace';
import type { TGitAskProvider } from '@/hooks/use-config-store';

const DEFAULT_GIT_PANEL_SIZE = 36;
const MIN_GIT_PANEL_SIZE = 20;
const MAX_GIT_PANEL_SIZE = 60;
const MIN_MAIN_PANEL_WIDTH = '320px';
const MIN_GIT_PANEL_WIDTH = '320px';
const MAX_GIT_PANEL_WIDTH = '760px';

const clampGitPanelSize = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_GIT_PANEL_SIZE;
  return Math.min(MAX_GIT_PANEL_SIZE, Math.max(MIN_GIT_PANEL_SIZE, n));
};

const getInitialGitPanelOpen = () => false;

const getInitialGitPanelSize = () => {
  const value = DEFAULT_GIT_PANEL_SIZE;
  if (!Number.isFinite(value)) return DEFAULT_GIT_PANEL_SIZE;
  return Math.min(MAX_GIT_PANEL_SIZE, Math.max(MIN_GIT_PANEL_SIZE, value));
};

const TerminalPage = () => {
  const t = useTranslations('terminal');
  const isLoading = useWorkspaceStore((s) => s.isLoading);
  const error = useWorkspaceStore((s) => s.error);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaceCount = useWorkspaceStore((s) => s.workspaces.length);
  const prevWorkspaceIdRef = useRef<string | null>(null);
  const equalizeRef = useRef<(() => void) | null>(null);
  const gitPanelGroupRef = useRef<GroupImperativeHandle>(null);
  const gitPanelSizePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gitPanelOpen, setGitPanelOpen] = useState(getInitialGitPanelOpen);
  const [gitPanelSize, setGitPanelSize] = useState(getInitialGitPanelSize);
  const [gitTarget, setGitTarget] = useState<{ sessionName: string; cwdKey: string } | null>(null);

  const handleFetchError = useCallback(() => {
    const prevId = prevWorkspaceIdRef.current;
    if (prevId) {
      useWorkspaceStore.getState().switchWorkspace(prevId);
      toast.error(t('cannotSwitch'));
    }
  }, [t]);

  const layout = useLayout({
    workspaceId: activeWorkspaceId,
    onFetchError: handleFetchError,
  });

  const allTabsEmpty = !!(
    layout.layout &&
    !layout.isLoading &&
    collectPanes(layout.layout.root).every((p) => p.tabs.length === 0)
  );
  const hasActiveLayout = !!(layout.layout && !layout.isLoading && !allTabsEmpty);

  const focusedPane = useMemo(() => {
    if (!layout.layout?.activePaneId) return null;
    return collectPanes(layout.layout.root).find((p) => p.id === layout.layout?.activePaneId) ?? null;
  }, [layout.layout]);

  const focusedTab = useMemo(() => {
    if (!focusedPane?.activeTabId) return null;
    return focusedPane.tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? null;
  }, [focusedPane]);
  const focusedTabCwd = useTabMetadataStore(
    (state) => (focusedTab?.id ? state.metadata[focusedTab.id]?.cwd : undefined),
  );
  const activeSessionNames = useMemo(() => {
    if (!layout.layout) return new Set<string>();
    return new Set(collectPanes(layout.layout.root).flatMap((pane) => pane.tabs.map((tab) => tab.sessionName)));
  }, [layout.layout]);

  useEffect(() => {
    if (!layout.layout) return;
    setGitPanelOpen(layout.layout.diffSettings?.panelOpen ?? false);
    setGitPanelSize(clampGitPanelSize(layout.layout.diffSettings?.panelSize));
  }, [activeWorkspaceId, layout.layout]);

  const setGitPanelOpenPersisted = useCallback((open: boolean) => {
    setGitPanelOpen(open);
    layout.updateDiffSettings({ panelOpen: open });
  }, [layout]);

  const setGitPanelSizePersisted = useCallback((size: number) => {
    setGitPanelSize(size);
    if (gitPanelSizePersistTimerRef.current) {
      clearTimeout(gitPanelSizePersistTimerRef.current);
    }
    gitPanelSizePersistTimerRef.current = setTimeout(() => {
      layout.updateDiffSettings({ panelSize: size });
      gitPanelSizePersistTimerRef.current = null;
    }, 200);
  }, [layout]);

  useEffect(() => () => {
    if (gitPanelSizePersistTimerRef.current) {
      clearTimeout(gitPanelSizePersistTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!gitPanelSizePersistTimerRef.current) return;
    clearTimeout(gitPanelSizePersistTimerRef.current);
    gitPanelSizePersistTimerRef.current = null;
  }, [activeWorkspaceId]);

  const handleSendDiffToAgent = useCallback((text: string, provider: TGitAskProvider) => {
    if (!focusedPane?.id) return;
    window.dispatchEvent(new CustomEvent('purplemux-send-to-agent', {
      detail: { paneId: focusedPane.id, text, provider },
    }));
  }, [focusedPane?.id]);

  useEffect(() => {
    const handleToggle = () => setGitPanelOpenPersisted(!gitPanelOpen);
    window.addEventListener('purplemux-toggle-git-panel', handleToggle);
    return () => window.removeEventListener('purplemux-toggle-git-panel', handleToggle);
  }, [gitPanelOpen, setGitPanelOpenPersisted]);

  useEffect(() => {
    const sessionName = focusedTab?.sessionName;
    if (!sessionName) return;
    const cwdKey = focusedTabCwd || focusedTab.cwd || sessionName;
    setGitTarget((prev) => {
      if (prev?.cwdKey === cwdKey && activeSessionNames.has(prev.sessionName)) return prev;
      return { sessionName, cwdKey };
    });
  }, [activeSessionNames, focusedTab?.sessionName, focusedTab?.cwd, focusedTabCwd]);

  useEffect(() => {
    if (!hasActiveLayout) return;
    gitPanelGroupRef.current?.setLayout(
      gitPanelOpen
        ? { main: 100 - gitPanelSize, git: gitPanelSize }
        : { main: 100, git: 0 },
    );
  }, [activeWorkspaceId, gitPanelOpen, gitPanelSize, hasActiveLayout]);

  // Hydrate store from layout data
  const layoutUpdatedAt = layout.layout?.updatedAt;
  const hydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!layout.layout || !layoutUpdatedAt) return;
    if (hydratedRef.current === layoutUpdatedAt) return;
    hydratedRef.current = layoutUpdatedAt;
    const metadata: Record<string, ITabMetadata> = {};
    for (const pane of collectPanes(layout.layout.root)) {
      for (const tab of pane.tabs) {
        if (tab.panelType === 'agent-sessions') continue;
        if (tab.title || tab.cwd) {
          metadata[tab.id] = { title: tab.title, cwd: tab.cwd };
        }
      }
    }
    useTabMetadataStore.getState().hydrate(metadata);
    requestSync();
  }, [layoutUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup stale tab metadata
  useEffect(() => {
    if (!layout.layout) return;
    const allTabIds = new Set(
      collectPanes(layout.layout.root).flatMap((p) => p.tabs.map((t) => t.id)),
    );
    useTabMetadataStore.getState().retainOnly(allTabIds);
  }, [layout.layout]);

  useAutoDeleteEmptyWorkspace(allTabsEmpty, layout.clearLayout);

  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      const { activeWorkspaceId } = useWorkspaceStore.getState();

      if (workspaceId === activeWorkspaceId) return;

      prevWorkspaceIdRef.current = activeWorkspaceId;
      useTabMetadataStore.getState().reset();
      layout.clearLayout();
      useWorkspaceStore.getState().switchWorkspace(workspaceId);
    },
    [layout],
  );

  useEffect(() => {
    useSidebarActions.getState().register(handleSelectWorkspace);
    return () => useSidebarActions.getState().unregister();
  }, [handleSelectWorkspace]);

  useKeyboardShortcuts({ layout });

  if (isLoading) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-background animate-delayed-fade-in">
        <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-4 w-16 animate-pulse rounded bg-muted"
            />
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Spinner className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{t('connecting')}</span>
          </div>
        </div>
      </div>
    );
  }

  if (error && !workspaceCount) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden bg-background">
        <AlertTriangle className="h-5 w-5 text-ui-amber" />
        <span className="text-sm text-muted-foreground">{error}</span>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={useWorkspaceStore.getState().fetchWorkspaces}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('retryAction')}
        </Button>
      </div>
    );
  }

  const showSwitching = !layout.layout && layout.isLoading && activeWorkspaceId;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      {layout.layout && !layout.isLoading && !allTabsEmpty && (
        <ContentHeader
          activePaneId={layout.layout.activePaneId}
          root={layout.layout.root}
          paneCount={layout.paneCount}
          canSplit={layout.canSplit}
          isSplitting={layout.isSplitting}
          onSplitPane={layout.splitPane}
          onEqualizeRatios={() => equalizeRef.current?.()}
          isGitPanelOpen={gitPanelOpen}
          onToggleGitPanel={() => setGitPanelOpenPersisted(!gitPanelOpen)}
        />
      )}

      <div className="relative min-h-0 flex-1">
        {showSwitching && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background animate-delayed-fade-in">
            <Spinner className="h-4 w-4 text-muted-foreground" />
          </div>
        )}

        {layout.error && !layout.isLoading && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <AlertTriangle className="h-5 w-5 text-ui-amber" />
            <span className="text-sm text-muted-foreground">{layout.error}</span>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => layout.fetchLayout()}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('retryAction')}
            </Button>
          </div>
        )}

        {layout.layout && !layout.isLoading && !allTabsEmpty && (
          <div
            key={activeWorkspaceId}
            className="h-full"
          >
            <Group
              groupRef={gitPanelGroupRef}
              className="h-full w-full min-w-0"
              orientation="horizontal"
              resizeTargetMinimumSize={{ fine: 8, coarse: 32 }}
              defaultLayout={gitPanelOpen
                ? { main: 100 - gitPanelSize, git: gitPanelSize }
                : { main: 100, git: 0 }}
              onLayoutChanged={(sizes) => {
                if (!gitPanelOpen) return;
                const next = sizes.git;
                if (next === undefined || next <= 1) return;
                const clamped = Math.min(MAX_GIT_PANEL_SIZE, Math.max(MIN_GIT_PANEL_SIZE, Math.round(next)));
                if (clamped === gitPanelSize) return;
                setGitPanelSizePersisted(clamped);
              }}
            >
              <Panel id="main" minSize={MIN_MAIN_PANEL_WIDTH} className="h-full min-w-0">
                <PaneLayout
                  root={layout.layout.root}
                  onUpdateRatio={layout.updateRatio}
                  onEqualizeRatios={layout.equalizeRatios}
                  equalizeRef={equalizeRef}
                />
              </Panel>
              <Separator
                disabled={!gitPanelOpen}
                className={cn(
                  'shrink-0 cursor-col-resize bg-border transition-colors duration-100 hover:bg-muted-foreground/50 data-[resize-handle-active]:bg-muted-foreground',
                  gitPanelOpen ? 'w-px' : 'w-0',
                )}
              />
              <Panel
                id="git"
                collapsible
                collapsedSize="0px"
                minSize={MIN_GIT_PANEL_WIDTH}
                maxSize={MAX_GIT_PANEL_WIDTH}
                groupResizeBehavior="preserve-pixel-size"
                className="h-full min-w-0 overflow-hidden"
              >
                {gitPanelOpen && (
                  <GitSidePanel
                    sessionName={gitTarget?.sessionName}
                    onClose={() => setGitPanelOpenPersisted(false)}
                    onSendToAgent={handleSendDiffToAgent}
                    settings={layout.layout.diffSettings}
                    onSettingsChange={layout.updateDiffSettings}
                  />
                )}
              </Panel>
            </Group>
          </div>
        )}

        {!activeWorkspaceId && !isLoading && !error && (
          <div className="flex h-full items-center justify-center">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                const created = await useWorkspaceStore.getState().createWorkspace('');
                if (created) useWorkspaceStore.getState().switchWorkspace(created.id);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('newWorkspace')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalPage;
