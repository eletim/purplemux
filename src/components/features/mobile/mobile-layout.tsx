import { useState, type ReactNode } from 'react';
import AppHeader from '@/components/layout/app-header';
import MobileNavigationSheet from '@/components/features/mobile/mobile-navigation-sheet';
import MobileWorkspaceTabBar from '@/components/features/mobile/mobile-workspace-tab-bar';
import SettingsDialog from '@/components/features/workspace/settings-dialog';
import useWorkspaceStore from '@/hooks/use-workspace-store';
import type { IWorkspaceChromeSourceAdapter } from '@/types/workspace-chrome';

interface IMobileLayoutProps {
  children: ReactNode;
  source: IWorkspaceChromeSourceAdapter;
}

const MobileLayout = ({ children, source }: IMobileLayoutProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const settingsOpen = useWorkspaceStore((state) => state.isSettingsDialogOpen);
  const setSettingsOpen = useWorkspaceStore((state) => state.setSettingsDialogOpen);
  const activeWorkspace = source.workspaces.find((workspace) => workspace.id === source.activeWorkspaceId);

  return (
    <>
      <div style={{ paddingTop: 'env(safe-area-inset-top)' }} className="shrink-0">
        <AppHeader
          onMenuOpen={() => setMenuOpen(true)}
          workspaceId={source.capabilities.renameWorkspace ? source.activeWorkspaceId ?? undefined : undefined}
          workspaceName={source.kind === 'external' ? source.label : activeWorkspace?.name}
          capabilities={source.capabilities}
        />
      </div>
      {children}
      <MobileWorkspaceTabBar source={source} />
      <MobileNavigationSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        source={source}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {source.capabilities.persistenceControls && (
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      )}
    </>
  );
};

export default MobileLayout;
