import Head from 'next/head';
import dynamic from 'next/dynamic';
import type { GetServerSideProps } from 'next';
import { AlertTriangle } from 'lucide-react';
import PaneTabBar from '@/components/features/workspace/pane-tab-bar';
import MobileTabHeader from '@/components/features/mobile/mobile-tab-header';
import ExternalServerControls from '@/components/features/workspace/external-server-controls';
import WorkspaceChromeShell from '@/components/layout/workspace-chrome-shell';
import { useWorkspaceChromeSource } from '@/components/layout/workspace-chrome-context';
import useExternalWorkspaceSource from '@/hooks/use-external-workspace-source';
import useIsMobile from '@/hooks/use-is-mobile';
import { requireAuth } from '@/lib/require-auth';
import { loadMessagesServer } from '@/lib/load-messages';

const TerminalSurface = dynamic(
  () => import('@/components/features/workspace/terminal-surface'),
  { ssr: false },
);

const EmptySurface = ({ message }: { message: string }) => (
  <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground" role="status">
    {message}
  </div>
);

const ExternalWorkspaceContent = ({ emptyMessage }: { emptyMessage: string }) => {
  const source = useWorkspaceChromeSource();
  const isMobile = useIsMobile();
  const activePane = source.activeWorkspaceId && source.activePaneId
    ? source.workspaceLayouts[source.activeWorkspaceId]?.find((pane) => pane.id === source.activePaneId) ?? null
    : null;
  const activeTabs = activePane?.tabs ?? [];
  const activeTab = activeTabs.find((tab) => tab.id === source.activeTabId) ?? null;
  const terminalTarget = activeTab ? source.terminalTargets[activeTab.id] : null;
  const activeTarget = terminalTarget?.kind === 'external' ? terminalTarget : null;
  const createActiveTab = () => {
    if (source.activeWorkspaceId) void source.createTab?.(source.activeWorkspaceId);
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col" data-workspace-source="external">
      <Head><title>External tmux · purplemux</title></Head>
      {!isMobile && (
        <PaneTabBar
          paneId={source.activePaneId ?? 'external-pane'}
          tabs={activeTabs}
          activeTabId={source.activeTabId}
          isLoading={source.isLoading && activeTabs.length === 0}
          error={null}
          isCreating={source.isCreatingTab}
          paneCount={1}
          isSplitting={false}
          onSwitchTab={(tabId) => {
            if (source.activeWorkspaceId && source.activePaneId) {
              source.selectTab(source.activeWorkspaceId, source.activePaneId, tabId);
            }
          }}
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
      )}
      {isMobile && activeTab && (
        <MobileTabHeader
          tabId={activeTab.id}
          tabName={activeTab.name}
          sessionName={null}
          externalTerminalTarget={activeTarget}
          cwdKey={null}
          panelType="terminal"
          onSwitchPanelType={() => {}}
          onCreateTab={createActiveTab}
          onOpenGit={() => {}}
          onClose={() => {}}
          capabilities={source.capabilities}
        />
      )}
      {source.error && (
        <p className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-ui-red" role="alert">
          <AlertTriangle className="h-3.5 w-3.5" />
          {source.error}
        </p>
      )}
      {activeTarget ? (
        <TerminalSurface
          key={`${activeTarget.serverId}:${activeTarget.sessionId}:${activeTarget.windowId}`}
          target={activeTarget}
          className="h-full min-h-0 flex-1 rounded-none border-0"
        />
      ) : (
        <EmptySurface message={emptyMessage} />
      )}
    </main>
  );
};

export const ExternalWorkspaceChromePage = () => {
  const { source, controls, emptyMessage } = useExternalWorkspaceSource();
  return (
    <WorkspaceChromeShell
      source={source}
      navigationHeader={<ExternalServerControls controls={controls} />}
    >
      <ExternalWorkspaceContent emptyMessage={emptyMessage} />
    </WorkspaceChromeShell>
  );
};

export default ExternalWorkspaceChromePage;

export const getServerSideProps: GetServerSideProps = (context) => requireAuth(context,
  async () => ({ props: { messages: await loadMessagesServer() } }), { skipPreflight: true });
