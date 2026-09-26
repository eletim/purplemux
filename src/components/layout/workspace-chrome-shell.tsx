import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import useIsMobile from '@/hooks/use-is-mobile';
import useSync from '@/hooks/use-sync';
import useGlobalShortcuts from '@/hooks/use-global-shortcuts';
import useWebviewStore from '@/hooks/use-webview-store';
import Sidebar from '@/components/layout/sidebar';
import MobileLayout from '@/components/features/mobile/mobile-layout';
import { WorkspaceChromeProvider } from '@/components/layout/workspace-chrome-context';
import type { IWorkspaceChromeSourceAdapter } from '@/types/workspace-chrome';

const WebviewLayer = dynamic(() => import('@/components/layout/webview-layer'), { ssr: false });

const ManagedRuntimeSync = () => {
  useSync();
  useGlobalShortcuts();
  return null;
};

const PageContent = ({ children, managed }: { children: ReactNode; managed: boolean }) => {
  const webviewActive = useWebviewStore((state) => managed && state.activeId !== null);
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ display: webviewActive ? 'none' : undefined }}>
      {children}
    </div>
  );
};

export default function WorkspaceChromeShell({
  source,
  children,
}: {
  source: IWorkspaceChromeSourceAdapter;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const managed = source.kind === 'managed';

  return (
    <WorkspaceChromeProvider source={source}>
      {managed && <ManagedRuntimeSync />}
      {isMobile ? (
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
          <MobileLayout source={source}>{children}</MobileLayout>
        </div>
      ) : (
        <div className="flex h-dvh w-full overflow-hidden bg-background max-md:hidden">
          <Sidebar source={source} />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <PageContent managed={managed}>{children}</PageContent>
            {managed && <WebviewLayer />}
          </div>
        </div>
      )}
    </WorkspaceChromeProvider>
  );
}
