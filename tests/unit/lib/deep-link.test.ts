import { describe, expect, it, vi } from 'vitest';
import { followDeepLink, parseDeepLinkTarget } from '@/hooks/use-deep-link';
import type { TNavigateToTabResult } from '@/hooks/use-layout';

describe('parseDeepLinkTarget', () => {
  it('accepts the canonical workspace and tab query parameters', () => {
    expect(parseDeepLinkTarget('ws-123', 'tab-456')).toEqual({
      workspaceId: 'ws-123',
      tabId: 'tab-456',
    });
  });

  it.each([
    [undefined, 'tab-456'],
    ['ws-123', undefined],
    ['', 'tab-456'],
    ['ws-123', ''],
    [['ws-123'], 'tab-456'],
    ['ws-123', ['tab-456']],
  ])('ignores incomplete or repeated query parameters', (workspace, tab) => {
    expect(parseDeepLinkTarget(workspace, tab)).toBeNull();
  });
});

describe('followDeepLink', () => {
  const target = { workspaceId: 'ws-123', tabId: 'tab-456' };

  const makeActions = () => ({
    navigate: vi.fn<() => Promise<TNavigateToTabResult>>(async () => 'focused'),
    notifyWorkspaceNotFound: vi.fn(),
    notifyTabNotFound: vi.fn(),
  });

  it('delegates successful navigation to the shared tab navigation boundary', async () => {
    const actions = makeActions();

    await expect(followDeepLink(target, true, actions)).resolves.toBe('focused');

    expect(actions.navigate).toHaveBeenCalledWith('ws-123', 'tab-456');
    expect(actions.notifyWorkspaceNotFound).not.toHaveBeenCalled();
    expect(actions.notifyTabNotFound).not.toHaveBeenCalled();
  });

  it('falls back without navigating when the workspace does not exist', async () => {
    const actions = makeActions();

    await expect(followDeepLink(target, false, actions)).resolves.toBe('workspace-not-found');

    expect(actions.navigate).not.toHaveBeenCalled();
    expect(actions.notifyWorkspaceNotFound).toHaveBeenCalledOnce();
    expect(actions.notifyTabNotFound).not.toHaveBeenCalled();
  });

  it('keeps the workspace open and reports a missing tab', async () => {
    const actions = makeActions();
    actions.navigate.mockResolvedValue('not-found');

    await expect(followDeepLink(target, true, actions)).resolves.toBe('not-found');

    expect(actions.navigate).toHaveBeenCalledWith('ws-123', 'tab-456');
    expect(actions.notifyWorkspaceNotFound).not.toHaveBeenCalled();
    expect(actions.notifyTabNotFound).toHaveBeenCalledOnce();
  });
});
