import { useState } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import type { GetServerSideProps } from 'next';
import { AlertTriangle, Menu } from 'lucide-react';
import Sidebar from '@/components/layout/sidebar';
import PaneTabBar from '@/components/features/workspace/pane-tab-bar';
import MobileTabHeader from '@/components/features/mobile/mobile-tab-header';
import MobileWorkspaceTabBar from '@/components/features/mobile/mobile-workspace-tab-bar';
import MobileNavigationSheet from '@/components/features/mobile/mobile-navigation-sheet';
import useExternalWorkspaceSource from '@/hooks/use-external-workspace-source';
import useIsMobile from '@/hooks/use-is-mobile';
import { requireAuth } from '@/lib/require-auth';
import { loadMessagesServer } from '@/lib/load-messages';

const ExternalTerminalSurface = dynamic(
  () => import('@/components/features/workspace/external-terminal-surface'),
  { ssr: false },
);

const EmptySurface = ({ message }: { message: string }) => (
  <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground" role="status">
    {message}
  </div>
);

const ExternalWorkspaceChrome = () => {
  const { source, activeTarget, creating } = useExternalWorkspaceSource();
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const activePane = source.activeWorkspaceId && source.activePaneId
    ? source.workspaceLayouts[source.activeWorkspaceId]?.find((pane) => pane.id === source.activePaneId) ?? null
    : null;
  const activeTabs = activePane?.tabs ?? [];
  const activeTab = activeTabs.find((tab) => tab.id === source.activeTabId) ?? null;
  const terminal = activeTarget
    ? <ExternalTerminalSurface
        key={`${activeTarget.serverId}:${activeTarget.sessionId}:${activeTarget.windowId}`}
        externalTerminalTarget={activeTarget}
        className="h-full min-h-0 flex-1 rounded-none border-0"
      />
    : <EmptySurface message={source.isLoading ? 'Loading external workspaces…' : 'No external windows are available.'} />;
  const createActiveTab = () => {
    if (source.activeWorkspaceId) void source.createTab?.(source.activeWorkspaceId);
  };

  if (!isMobile) {
    return (
      <div className="flex h-dvh w-full overflow-hidden bg-background">
        <Sidebar source={source} />
        <main className="flex min-w-0 flex-1 flex-col" data-workspace-source="external">
          <PaneTabBar
            paneId={source.activePaneId ?? 'external-pane'}
            tabs={activeTabs}
            activeTabId={source.activeTabId}
            isLoading={source.isLoading && activeTabs.length === 0}
            error={null}
            isCreating={creating}
            onSwitchTab={(tabId) => {
              if (source.activeWorkspaceId && source.activePaneId) {
                source.selectTab(source.activeWorkspaceId, source.activePaneId, tabId);
              }
            }}
            paneCount={1}
            isSplitting={false}
            onCreateTab={createActiveTab}
            onDeleteTab={() => {}}
            onRenameTab={() => {}}
            onSwitchPanelType={() => {}}
            onReorderTabs={() => {}}
            onClosePane={() => {}}
            onMoveTab={() => {}}
            onFocusPane={() => {}}
            onRetry={source.refresh}
            capabilities={source.capabilities}
          />
          {source.error && (
            <p className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-ui-red" role="alert">
              <AlertTriangle className="h-3.5 w-3.5" />
              {source.error}
            </p>
          )}
          {terminal}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background" data-workspace-source="external">
      <div style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex h-12 items-center gap-2 border-b border-border px-2">
          <button
            className="flex h-10 w-10 items-center justify-center text-muted-foreground"
            onClick={() => setMenuOpen(true)}
            aria-label="Open workspace navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{source.label}</span>
        </div>
      </div>
      {activeTab && (
        <MobileTabHeader
          tabId={activeTab.id}
          tabName={activeTab.name}
          sessionName={null}
          cwdKey={null}
          panelType="terminal"
          onSwitchPanelType={() => {}}
          onCreateTab={createActiveTab}
          onOpenGit={() => {}}
          onClose={() => {}}
          capabilities={source.capabilities}
        />
      )}
      {source.error && <p className="px-3 py-2 text-xs text-ui-red" role="alert">{source.error}</p>}
      {terminal}
      <MobileWorkspaceTabBar
        workspaces={source.workspaces}
        activeWorkspaceId={source.activeWorkspaceId}
        workspaceLayouts={source.workspaceLayouts}
        selectedPaneId={source.activePaneId}
        selectedTabId={source.activeTabId}
        onSelect={source.selectTab}
        capabilities={source.capabilities}
      />
      <MobileNavigationSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        workspaces={source.workspaces}
        activeWorkspaceId={source.activeWorkspaceId}
        workspaceLayouts={source.workspaceLayouts}
        activePaneId={source.activePaneId}
        activeTabId={source.activeTabId}
        onSelectSurface={(workspaceId, paneId, tabId) => {
          setMenuOpen(false);
          source.selectTab(workspaceId, paneId, tabId);
        }}
        onCreateWorkspace={async () => {}}
        onOpenSettings={() => {}}
        capabilities={source.capabilities}
        sourceLabel={source.label}
      />
    </div>
  );
};

export default function ExternalServersPage() {
  return (
    <>
      <Head><title>External tmux · purplemux</title></Head>
      <ExternalWorkspaceChrome />
    </>
  );
}

export const getServerSideProps: GetServerSideProps = (context) => requireAuth(context,
  async () => ({ props: { messages: await loadMessagesServer() } }), { skipPreflight: true });
