import { describe, expect, it, vi } from 'vitest';
import {
  closeTabRuntime,
  type ICloseTabRuntimeDependencies,
} from '@/lib/tab-runtime';

const location = {
  workspaceId: 'ws-1',
  paneId: 'pane-1',
  tab: {
    id: 'tab-1',
    sessionName: 'session-1',
    name: 'Agent',
    order: 0,
    panelType: 'codex-cli' as const,
  },
};

const dependencies = (
  overrides: Partial<ICloseTabRuntimeDependencies> = {},
): ICloseTabRuntimeDependencies => ({
  findTab: vi.fn().mockResolvedValue(location),
  removeTabFromPane: vi.fn().mockResolvedValue(true),
  ...overrides,
});

describe('closeTabRuntime', () => {
  it('resolves the tab and delegates all close semantics to removeTabFromPane', async () => {
    const deps = dependencies();

    await expect(closeTabRuntime({ workspaceId: 'ws-1', tabId: 'tab-1' }, deps))
      .resolves.toEqual(location);

    expect(deps.findTab).toHaveBeenCalledOnce();
    expect(deps.findTab).toHaveBeenCalledWith('ws-1', 'tab-1');
    expect(deps.removeTabFromPane).toHaveBeenCalledOnce();
    expect(deps.removeTabFromPane).toHaveBeenCalledWith('ws-1', 'pane-1', 'tab-1');
  });

  it('rejects a missing workspace or tab with the existing not-found contract', async () => {
    const deps = dependencies({ findTab: vi.fn().mockResolvedValue(null) });

    await expect(closeTabRuntime({ workspaceId: 'ws-missing', tabId: 'tab-1' }, deps))
      .rejects.toMatchObject({
        status: 404,
        body: { error: 'Tab not found' },
      });
    expect(deps.removeTabFromPane).not.toHaveBeenCalled();
  });

  it('does not close a tab through a mismatched UI pane route', async () => {
    const deps = dependencies();

    await expect(closeTabRuntime({
      workspaceId: 'ws-1',
      paneId: 'pane-other',
      tabId: 'tab-1',
    }, deps)).rejects.toMatchObject({ status: 404, body: { error: 'Tab not found' } });
    expect(deps.removeTabFromPane).not.toHaveBeenCalled();
  });

  it('returns not found if the tab disappears before removal', async () => {
    const deps = dependencies({ removeTabFromPane: vi.fn().mockResolvedValue(false) });

    await expect(closeTabRuntime({ workspaceId: 'ws-1', tabId: 'tab-1' }, deps))
      .rejects.toMatchObject({ status: 404, body: { error: 'Tab not found' } });
  });
});
