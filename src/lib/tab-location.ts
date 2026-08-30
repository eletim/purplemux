import { getLayout } from '@/lib/layout-store';
import { collectPanes } from '@/lib/layout-tree';
import { getWorkspaceById } from '@/lib/workspace-store';
import type { ITab } from '@/types/terminal';

export interface ITabLocation {
  workspaceId: string;
  paneId: string;
  tab: ITab;
}

export const findTab = async (
  workspaceId: string,
  tabId: string,
): Promise<ITabLocation | null> => {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return null;
  const layout = await getLayout(workspaceId);
  for (const pane of collectPanes(layout.root)) {
    const tab = pane.tabs.find((candidate) => candidate.id === tabId);
    if (tab) return { workspaceId, paneId: pane.id, tab };
  }
  return null;
};
