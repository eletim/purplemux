import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sessions: [] as string[] }));

vi.mock('@/lib/tmux', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tmux')>(),
  listSessionsForSafetyCheck: vi.fn(async () => mocks.sessions),
}));
vi.mock('@/lib/sync-server', () => ({ broadcastSync: vi.fn() }));

let tempHome: string;
let originalHome: string | undefined;

const workspace = (id: string) => ({ id, name: id, directories: [`/${id}`] });
const emptyLayout = { root: { type: 'pane', id: 'pane-1', tabs: [], activeTabId: null }, activePaneId: 'pane-1' };
const nonEmptyLayout = {
  root: {
    type: 'pane', id: 'pane-1', activeTabId: 'tab-1',
    tabs: [{ id: 'tab-1', sessionName: 'pt-ws-target-pane-1-tab-1', name: '', order: 0 }],
  },
  activePaneId: 'pane-1',
};

beforeAll(async () => {
  originalHome = process.env.HOME;
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-delete-test-'));
  process.env.HOME = tempHome;
});

afterAll(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await fs.rm(tempHome, { recursive: true, force: true });
});

beforeEach(async () => {
  mocks.sessions = [];
  await fs.rm(path.join(tempHome, '.purplemux'), { recursive: true, force: true });
});

const seed = async (targetLayout: object) => {
  const base = path.join(tempHome, '.purplemux');
  const data = {
    workspaces: [workspace('ws-target'), workspace('ws-other')],
    groups: [], activeWorkspaceId: 'ws-target', sidebarCollapsed: false, sidebarWidth: 240,
    updatedAt: '2026-09-05T00:00:00.000Z',
  };
  await fs.mkdir(path.join(base, 'workspaces', 'ws-target'), { recursive: true });
  await fs.mkdir(path.join(base, 'workspaces', 'ws-other'), { recursive: true });
  await fs.writeFile(path.join(base, 'workspaces.json'), JSON.stringify(data));
  await fs.writeFile(path.join(base, 'workspaces', 'ws-target', 'layout.json'), JSON.stringify(targetLayout));
  await fs.writeFile(path.join(base, 'workspaces', 'ws-other', 'layout.json'), JSON.stringify(emptyLayout));
  return base;
};

describe('deleteWorkspaceIfEmpty', () => {
  it('deletes metadata and persisted state for only the exact empty target', async () => {
    const base = await seed(emptyLayout);
    const { deleteWorkspaceIfEmpty } = await import('@/lib/workspace-store');
    await expect(deleteWorkspaceIfEmpty('ws-target')).resolves.toEqual({
      workspaceId: 'ws-target', status: 'deleted', deleted: true,
    });
    const stored = JSON.parse(await fs.readFile(path.join(base, 'workspaces.json'), 'utf8'));
    expect(stored.workspaces).toEqual([workspace('ws-other')]);
    expect(stored.activeWorkspaceId).toBe('ws-other');
    await expect(fs.access(path.join(base, 'workspaces', 'ws-target'))).rejects.toThrow();
    await expect(fs.access(path.join(base, 'workspaces', 'ws-other', 'layout.json'))).resolves.toBeUndefined();
  });

  it('rejects a registered tab without changing metadata or either workspace', async () => {
    const base = await seed(nonEmptyLayout);
    const before = await fs.readFile(path.join(base, 'workspaces.json'), 'utf8');
    const { deleteWorkspaceIfEmpty } = await import('@/lib/workspace-store');
    await expect(deleteWorkspaceIfEmpty('ws-target')).resolves.toEqual({
      workspaceId: 'ws-target', status: 'not-empty', deleted: false, tabCount: 1, sessionCount: 0,
    });
    expect(await fs.readFile(path.join(base, 'workspaces.json'), 'utf8')).toBe(before);
    await expect(fs.access(path.join(base, 'workspaces', 'ws-target', 'layout.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(base, 'workspaces', 'ws-other', 'layout.json'))).resolves.toBeUndefined();
  });

  it('rejects a target-owned tmux resource and ignores another workspace session', async () => {
    const base = await seed(emptyLayout);
    mocks.sessions = ['pt-ws-target-pane-x-tab-x', 'pt-ws-other-pane-y-tab-y'];
    const { deleteWorkspaceIfEmpty } = await import('@/lib/workspace-store');
    const result = await deleteWorkspaceIfEmpty('ws-target');
    expect(result).toMatchObject({ status: 'not-empty', sessionCount: 1 });
    const stored = JSON.parse(await fs.readFile(path.join(base, 'workspaces.json'), 'utf8'));
    expect(stored.workspaces).toHaveLength(2);
  });

  it('returns an idempotent absent result without touching another workspace', async () => {
    const base = await seed(emptyLayout);
    const { deleteWorkspaceIfEmpty } = await import('@/lib/workspace-store');
    await expect(deleteWorkspaceIfEmpty('ws-missing')).resolves.toEqual({
      workspaceId: 'ws-missing', status: 'absent', deleted: false,
    });
    await expect(fs.access(path.join(base, 'workspaces', 'ws-other', 'layout.json'))).resolves.toBeUndefined();
  });
});
