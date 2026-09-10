import { describe, expect, it } from 'vitest';
import { WorkspaceTerminal } from '@/pages/index';

describe('WorkspaceTerminal', () => {
  it('withholds the active workspace component until initial deep-link navigation resolves', () => {
    expect(WorkspaceTerminal({ isMobile: false, isDeepLinkResolving: true })).toBeNull();
    expect(WorkspaceTerminal({ isMobile: true, isDeepLinkResolving: true })).toBeNull();
  });

  it('renders the selected terminal component after deep-link navigation resolves', () => {
    expect(WorkspaceTerminal({ isMobile: false, isDeepLinkResolving: false })).not.toBeNull();
    expect(WorkspaceTerminal({ isMobile: true, isDeepLinkResolving: false })).not.toBeNull();
  });
});
