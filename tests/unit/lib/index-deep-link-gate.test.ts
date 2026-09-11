import { describe, expect, it } from 'vitest';
import { WorkspaceTerminal } from '@/pages/index';

describe('WorkspaceTerminal', () => {
  it('withholds the active workspace component until initial deep-link navigation resolves', () => {
    expect(WorkspaceTerminal({
      isMobile: false,
      isDeepLinkResolving: true,
      resolvedLayoutWorkspaceId: null,
    })).toBeNull();
    expect(WorkspaceTerminal({
      isMobile: true,
      isDeepLinkResolving: true,
      resolvedLayoutWorkspaceId: null,
    })).toBeNull();
  });

  it('passes the completed read-only workspace through the terminal mount', () => {
    const desktop = WorkspaceTerminal({
      isMobile: false,
      isDeepLinkResolving: false,
      resolvedLayoutWorkspaceId: 'ws-target',
    });
    const mobile = WorkspaceTerminal({
      isMobile: true,
      isDeepLinkResolving: false,
      resolvedLayoutWorkspaceId: 'ws-target',
    });

    expect(desktop?.props).toMatchObject({ initialLayoutWorkspaceId: 'ws-target' });
    expect(mobile?.props).toMatchObject({ initialLayoutWorkspaceId: 'ws-target' });
  });
});
