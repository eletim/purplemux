// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import useWorkspaceStore from '@/hooks/use-workspace-store';

describe('workspace cleanup store mutation', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'ws-empty', name: 'Empty', directories: ['/tmp/empty'] },
        { id: 'ws-kept', name: 'Kept', directories: ['/tmp/kept'] },
      ],
      groups: [],
      activeWorkspaceId: 'ws-kept',
      pendingDeleteIds: new Set(),
      isLoading: false,
      error: null,
    });
  });

  it('fences, marks, reconciles, and unmarks bulk deletion targets', async () => {
    let finishCleanup!: (response: Response) => void;
    const cleanupResponse = new Promise<Response>((resolve) => {
      finishCleanup = resolve;
    });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => cleanupResponse)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          workspaces: [{ id: 'ws-kept', name: 'Kept', directories: ['/tmp/kept'] }],
          groups: [],
          activeWorkspaceId: 'ws-kept',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const cleanup = useWorkspaceStore.getState().cleanupEmptyWorkspaces(['ws-empty']);
    expect(useWorkspaceStore.getState().pendingDeleteIds.has('ws-empty')).toBe(true);

    finishCleanup({ ok: true } as Response);
    await cleanup;

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspace/cleanup-empty', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ workspaceIds: ['ws-empty'] }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/workspace');
    expect(useWorkspaceStore.getState().workspaces.map((workspace) => workspace.id)).toEqual(['ws-kept']);
    expect(useWorkspaceStore.getState().pendingDeleteIds.size).toBe(0);
  });
});
