import { createContext, useContext, type ReactNode } from 'react';
import type { IWorkspaceChromeSourceAdapter } from '@/types/workspace-chrome';

const WorkspaceChromeContext = createContext<IWorkspaceChromeSourceAdapter | null>(null);

export const WorkspaceChromeProvider = ({
  source,
  children,
}: {
  source: IWorkspaceChromeSourceAdapter;
  children: ReactNode;
}) => (
  <WorkspaceChromeContext.Provider value={source}>
    {children}
  </WorkspaceChromeContext.Provider>
);

export const useWorkspaceChromeSource = (): IWorkspaceChromeSourceAdapter => {
  const source = useContext(WorkspaceChromeContext);
  if (!source) throw new Error('Workspace chrome source is unavailable');
  return source;
};
