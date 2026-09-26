import type { ReactElement, ReactNode } from 'react';
import WorkspaceChromeShell from '@/components/layout/workspace-chrome-shell';
import useManagedWorkspaceSource from '@/hooks/use-managed-workspace-source';

interface IPageShellProps {
  children: ReactNode;
}

const PageShell = ({ children }: IPageShellProps) => {
  const source = useManagedWorkspaceSource();
  return <WorkspaceChromeShell source={source}>{children}</WorkspaceChromeShell>;
};

export const getPageShellLayout = (page: ReactElement) => <PageShell>{page}</PageShell>;

export const getPageShellWithTitlebarLayout = (page: ReactElement) => (
  <PageShell>
    <div className="flex min-h-0 flex-1 flex-col pt-titlebar">{page}</div>
  </PageShell>
);

export default PageShell;
