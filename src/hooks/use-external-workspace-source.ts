import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import type { IExternalTerminalTarget, IPaneNode, ITab, IWorkspace } from '@/types/terminal';
import type {
  ICreatedExternalWorkspaceTab,
  IExternalWorkspace,
  IExternalWorkspaceSource,
} from '@/types/external-workspace';
import type { IExternalServerInventory } from '@/types/external-server';
import type { IWorkspaceChromeSourceAdapter } from '@/types/workspace-chrome';
import { externalWorkspaceChromeCapabilities } from '@/types/workspace-chrome';

const endpoint = '/api/cli/external-servers';
const refreshInterval = 5000;
const chromeId = (serverId: string, resourceId: string) =>
  `${encodeURIComponent(serverId)}:${resourceId}`;

interface IExternalWorkspaceChromeState {
  source: IWorkspaceChromeSourceAdapter;
  activeTarget: IExternalTerminalTarget | null;
  creating: boolean;
}

const readSources = async (): Promise<IExternalWorkspaceSource[]> => {
  const registrationsResponse = await fetch(endpoint);
  if (!registrationsResponse.ok) throw new Error('Unable to load external tmux servers.');
  const { servers } = await registrationsResponse.json() as { servers: IExternalServerInventory[] };
  return Promise.all(servers.map(async (server) => {
    const response = await fetch(`${endpoint}/${encodeURIComponent(server.id)}/workspaces`);
    if (!response.ok) throw new Error(`Unable to load external workspaces from ${server.name}.`);
    return response.json() as Promise<IExternalWorkspaceSource>;
  }));
};

export default function useExternalWorkspaceSource(): IExternalWorkspaceChromeState {
  const { data = [], error, isLoading, isValidating, mutate } = useSWR(
    'external-workspace-chrome',
    readSources,
    { refreshInterval },
  );
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<ICreatedExternalWorkspaceTab | null>(null);

  const model = useMemo(() => {
    const workspaces: IWorkspace[] = [];
    const workspaceLayouts: Record<string, IPaneNode[]> = {};
    const targets = new Map<string, IExternalTerminalTarget>();
    const rawWorkspaces = new Map<string, { serverId: string; workspace: IExternalWorkspace }>();
    const multipleSources = data.length > 1;

    for (const externalSource of data) {
      for (const workspace of externalSource.workspaces) {
        const workspaceId = chromeId(externalSource.serverId, workspace.id);
        workspaces.push({
          id: workspaceId,
          name: multipleSources ? `${externalSource.name} / ${workspace.name}` : workspace.name,
          directories: [],
        });
        rawWorkspaces.set(workspaceId, { serverId: externalSource.serverId, workspace });
        const tabs = workspace.tabs.map<ITab>((tab) => {
          const id = chromeId(externalSource.serverId, tab.id);
          targets.set(id, tab.externalTerminalTarget);
          return { id, sessionName: workspace.id, name: tab.name, order: tab.order };
        });
        if (optimistic?.workspaceId === workspace.id
          && optimistic.externalTerminalTarget.serverId === externalSource.serverId
          && !workspace.tabs.some((tab) => tab.id === optimistic.tabId)) {
          const id = chromeId(externalSource.serverId, optimistic.tabId);
          targets.set(id, optimistic.externalTerminalTarget);
          tabs.push({ id, sessionName: workspace.id, name: optimistic.tabId, order: tabs.length });
        }
        workspaceLayouts[workspaceId] = [{
          type: 'pane',
          id: `${workspaceId}:pane`,
          tabs,
          activeTabId: tabs.find((tab) => tab.id === selectedTabId)?.id
            ?? tabs.find((_tab, index) => workspace.tabs[index]?.active)?.id
            ?? tabs[0]?.id
            ?? null,
        }];
      }
    }
    return { workspaces, workspaceLayouts, targets, rawWorkspaces };
  }, [data, optimistic, selectedTabId]);

  const firstTab = model.workspaces
    .flatMap((workspace) => model.workspaceLayouts[workspace.id] ?? [])
    .flatMap((pane) => pane.tabs)[0];
  const effectiveTabId = selectedTabId && model.targets.has(selectedTabId)
    ? selectedTabId
    : firstTab?.id ?? null;
  const activeWorkspaceId = effectiveTabId
    ? model.workspaces.find((workspace) =>
      model.workspaceLayouts[workspace.id]?.some((pane) => pane.tabs.some((tab) => tab.id === effectiveTabId)))?.id ?? null
    : model.workspaces[0]?.id ?? null;
  const activePaneId = activeWorkspaceId
    ? model.workspaceLayouts[activeWorkspaceId]?.[0]?.id ?? null
    : null;

  const selectWorkspace = useCallback((workspaceId: string) => {
    const pane = model.workspaceLayouts[workspaceId]?.[0];
    setOptimistic(null);
    setSelectedTabId(pane?.activeTabId ?? pane?.tabs[0]?.id ?? null);
  }, [model.workspaceLayouts]);

  const selectTab = useCallback((_workspaceId: string, _paneId: string, tabId: string) => {
    setOptimistic(null);
    setSelectedTabId(tabId);
  }, []);

  const createTab = useCallback(async (workspaceId: string): Promise<ITab | null> => {
    const raw = model.rawWorkspaces.get(workspaceId);
    if (!raw) return null;
    setCreating(true);
    setMutationError(null);
    try {
      const response = await fetch(
        `${endpoint}/${encodeURIComponent(raw.serverId)}/workspaces/${encodeURIComponent(raw.workspace.id)}/tabs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionCreated: raw.workspace.sessionCreated }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to create external tab.');
      const created = body as ICreatedExternalWorkspaceTab;
      const id = chromeId(raw.serverId, created.tabId);
      setOptimistic(created);
      setSelectedTabId(id);
      void mutate().catch(() => {});
      return { id, sessionName: created.workspaceId, name: created.tabId, order: Number.MAX_SAFE_INTEGER };
    } catch (createError) {
      setMutationError(createError instanceof Error ? createError.message : 'Unable to create external tab.');
      return null;
    } finally {
      setCreating(false);
    }
  }, [model.rawWorkspaces, mutate]);

  const unavailable = data.find((externalSource) => !externalSource.exists);
  const source: IWorkspaceChromeSourceAdapter = {
    kind: 'external',
    label: data.length === 1 ? `External tmux · ${data[0].name}` : 'External tmux',
    workspaces: model.workspaces,
    workspaceLayouts: model.workspaceLayouts,
    activeWorkspaceId,
    activePaneId,
    activeTabId: effectiveTabId,
    isLoading: isLoading || isValidating,
    error: mutationError
      ?? (error instanceof Error ? error.message : null)
      ?? unavailable?.unavailableReason
      ?? null,
    capabilities: externalWorkspaceChromeCapabilities,
    selectWorkspace,
    selectTab,
    createTab,
    refresh: () => { void mutate(); },
  };

  return {
    source,
    activeTarget: effectiveTabId ? model.targets.get(effectiveTabId) ?? null : null,
    creating,
  };
}
