import { describe, expect, it } from 'vitest';
import { parseDeepLinkTarget } from '@/hooks/use-deep-link';

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
