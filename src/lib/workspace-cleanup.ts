import type { ITab, IWorkspace } from '@/types/terminal';

/**
 * Only layouts that have loaded successfully can be classified as empty.
 * The server repeats this check under its deletion lock before removing them.
 */
export const getEmptyWorkspaceIds = (
  workspaces: IWorkspace[],
  workspaceTabs: Record<string, ITab[]>,
): string[] => workspaces
  .filter((workspace) => workspaceTabs[workspace.id]?.length === 0)
  .map((workspace) => workspace.id);
