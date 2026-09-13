import { describe, expect, it } from 'vitest';
import { getEmptyWorkspaceIds } from '@/lib/workspace-cleanup';
import type { ITab, IWorkspace } from '@/types/terminal';

describe('getEmptyWorkspaceIds', () => {
  it('includes loaded empty layouts and excludes non-empty or unknown layouts', () => {
    const workspaces = [
      { id: 'ws-empty', name: 'Empty', directories: ['/empty'] },
      { id: 'ws-running', name: 'Running', directories: ['/running'] },
      { id: 'ws-unknown', name: 'Unknown', directories: ['/unknown'] },
    ] satisfies IWorkspace[];
    const runningTab = { id: 'tab-1' } as ITab;

    expect(getEmptyWorkspaceIds(workspaces, {
      'ws-empty': [],
      'ws-running': [runningTab],
    })).toEqual(['ws-empty']);
  });
});
