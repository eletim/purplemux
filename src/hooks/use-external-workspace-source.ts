import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import useSWR, { useSWRConfig } from 'swr';
import type { IExternalTerminalTarget, IPaneNode, ITab, IWorkspace } from '@/types/terminal';
import type {
  ICreatedExternalWorkspaceTab,
  IExternalWorkspace,
  IExternalWorkspaceSource,
} from '@/types/external-workspace';
import type {
  IExternalServer,
  IExternalServerInventory,
  IRegisterExternalServer,
} from '@/types/external-server';
import type { IWorkspaceChromeSourceAdapter } from '@/types/workspace-chrome';
import { externalWorkspaceChromeCapabilities } from '@/types/workspace-chrome';

const endpoint = '/api/cli/external-servers';
const refreshInterval = 5000;
const workspaceEndpoint = (serverId: string) =>
  `${endpoint}/${encodeURIComponent(serverId)}/workspaces`;
const chromeId = (serverId: string, resourceId: string) =>
  `${encodeURIComponent(serverId)}:${resourceId}`;
const requestStorageKey = (serverId: string, workspaceId: string, sessionCreated: string) =>
  `purplemux-external-tab-request:${serverId}:${workspaceId}:${sessionCreated}`;

export interface IExternalServerControls {
  servers: IExternalServerInventory[];
  selectedServerId: string | null;
  isLoading: boolean;
  isMutating: boolean;
  error: string | null;
  selectServer: (serverId: string) => void;
  registerServer: (input: IRegisterExternalServer) => Promise<boolean>;
  unregisterServer: () => Promise<boolean>;
}

interface IExternalWorkspaceChromeState {
  source: IWorkspaceChromeSourceAdapter;
  controls: IExternalServerControls;
  emptyMessage: string;
}

const readRegistrations = async (): Promise<IExternalServerInventory[]> => {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('Unable to load external tmux servers.');
  const { servers } = await response.json() as { servers: IExternalServerInventory[] };
  return servers;
};

const readSource = async (serverId: string): Promise<IExternalWorkspaceSource> => {
  const response = await fetch(workspaceEndpoint(serverId));
  if (!response.ok) throw new Error('Unable to load external workspaces from the selected server.');
  return response.json() as Promise<IExternalWorkspaceSource>;
};

export default function useExternalWorkspaceSource(): IExternalWorkspaceChromeState {
  const { mutate: mutateCache } = useSWRConfig();
  const {
    data: registrationData,
    error: registrationsError,
    isLoading: registrationsLoading,
    mutate: mutateRegistrations,
  } = useSWR('external-server-registrations', readRegistrations, { refreshInterval });
  const servers = useMemo(() => registrationData ?? [], [registrationData]);
  const [selectedServerPreference, setSelectedServerPreference] = useState<string | null>(null);
  const selectedServerId = selectedServerPreference
    && servers.some((server) => server.id === selectedServerPreference)
    ? selectedServerPreference
    : servers[0]?.id ?? null;
  const selectedServerIdRef = useRef<string | null>(selectedServerId);
  selectedServerIdRef.current = selectedServerId;
  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? null;
  const {
    data: externalSource,
    error: sourceError,
    isLoading: sourceLoading,
    mutate: mutateSource,
  } = useSWR(
    selectedServerId ? workspaceEndpoint(selectedServerId) : null,
    () => readSource(selectedServerId!),
    { refreshInterval },
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [controlsBusy, setControlsBusy] = useState(false);
  const [controlsError, setControlsError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<ICreatedExternalWorkspaceTab | null>(null);
  const requestIds = useRef(new Map<string, string>());

  useEffect(() => {
    if (!optimistic || !externalSource) return;
    const confirmed = externalSource.serverId === optimistic.externalTerminalTarget.serverId
      && externalSource.workspaces.some((workspace) =>
        workspace.id === optimistic.workspaceId
        && workspace.tabs.some((tab) => tab.id === optimistic.tabId));
    if (confirmed) setOptimistic((current) => current === optimistic ? null : current);
  }, [externalSource, optimistic]);

  const model = useMemo(() => {
    const workspaces: IWorkspace[] = [];
    const workspaceLayouts: Record<string, IPaneNode[]> = {};
    const targets = new Map<string, IExternalTerminalTarget>();
    const rawWorkspaces = new Map<string, { serverId: string; workspace: IExternalWorkspace }>();

    if (externalSource) {
      for (const workspace of externalSource.workspaces) {
        const workspaceId = chromeId(externalSource.serverId, workspace.id);
        workspaces.push({ id: workspaceId, name: workspace.name, directories: [] });
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
  }, [externalSource, optimistic, selectedTabId]);

  const workspaceForSelectedTab = selectedTabId
    ? model.workspaces.find((workspace) =>
      model.workspaceLayouts[workspace.id]?.some((pane) =>
        pane.tabs.some((tab) => tab.id === selectedTabId)))?.id ?? null
    : null;
  const activeWorkspaceId = selectedWorkspaceId && model.rawWorkspaces.has(selectedWorkspaceId)
    ? selectedWorkspaceId
    : workspaceForSelectedTab ?? model.workspaces[0]?.id ?? null;
  const activePaneId = activeWorkspaceId
    ? model.workspaceLayouts[activeWorkspaceId]?.[0]?.id ?? null
    : null;
  const activePane = activeWorkspaceId && activePaneId
    ? model.workspaceLayouts[activeWorkspaceId]?.find((pane) => pane.id === activePaneId) ?? null
    : null;
  const effectiveTabId = selectedTabId && activePane?.tabs.some((tab) => tab.id === selectedTabId)
    ? selectedTabId
    : activePane?.activeTabId ?? activePane?.tabs[0]?.id ?? null;

  const selectServer = useCallback((serverId: string) => {
    selectedServerIdRef.current = serverId;
    setOptimistic(null);
    setSelectedWorkspaceId(null);
    setSelectedTabId(null);
    setMutationError(null);
    setControlsError(null);
    setSelectedServerPreference(serverId);
  }, []);

  const selectWorkspace = useCallback((workspaceId: string) => {
    const pane = model.workspaceLayouts[workspaceId]?.[0];
    setOptimistic(null);
    setSelectedWorkspaceId(workspaceId);
    setSelectedTabId(pane?.activeTabId ?? pane?.tabs[0]?.id ?? null);
  }, [model.workspaceLayouts]);

  const selectTab = useCallback((workspaceId: string, _paneId: string, tabId: string) => {
    setOptimistic(null);
    setSelectedWorkspaceId(workspaceId);
    setSelectedTabId(tabId);
  }, []);

  const createTab = useCallback(async (workspaceId: string): Promise<ITab | null> => {
    const raw = model.rawWorkspaces.get(workspaceId);
    if (!raw) return null;
    const storageKey = requestStorageKey(raw.serverId, raw.workspace.id, raw.workspace.sessionCreated);
    let storedRequestId: string | null = null;
    try { storedRequestId = sessionStorage.getItem(storageKey); } catch { /* unavailable */ }
    const requestId = requestIds.current.get(storageKey) ?? storedRequestId ?? nanoid();
    requestIds.current.set(storageKey, requestId);
    try { sessionStorage.setItem(storageKey, requestId); } catch { /* unavailable */ }
    const clearRequestId = () => {
      requestIds.current.delete(storageKey);
      try { sessionStorage.removeItem(storageKey); } catch { /* unavailable */ }
    };
    setCreating(true);
    setMutationError(null);
    try {
      const response = await fetch(
        `${endpoint}/${encodeURIComponent(raw.serverId)}/workspaces/${encodeURIComponent(raw.workspace.id)}/tabs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionCreated: raw.workspace.sessionCreated, requestId }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        if (response.status < 500 && !body.outcomeUnknown) clearRequestId();
        throw new Error(body.error || 'Unable to create external tab.');
      }
      const created = body as ICreatedExternalWorkspaceTab;
      if (created.requestId !== requestId) {
        throw new Error('External tab creation outcome is unknown; retry to reconcile it.');
      }
      clearRequestId();
      const id = chromeId(raw.serverId, created.tabId);
      setOptimistic(created);
      setSelectedWorkspaceId(workspaceId);
      setSelectedTabId(id);
      void mutateSource().catch(() => {});
      return { id, sessionName: created.workspaceId, name: created.tabId, order: Number.MAX_SAFE_INTEGER };
    } catch (createError) {
      setMutationError(createError instanceof Error ? createError.message : 'Unable to create external tab.');
      return null;
    } finally {
      setCreating(false);
    }
  }, [model.rawWorkspaces, mutateSource]);

  const registerServer = useCallback(async (input: IRegisterExternalServer): Promise<boolean> => {
    setControlsBusy(true);
    setControlsError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to register external tmux server.');
      const registered = body as IExternalServer;
      await mutateRegistrations((current = []) => [
        ...current.filter((server) => server.id !== registered.id),
        { ...registered, exists: true, sessions: [] },
      ], { revalidate: false });
      selectServer(registered.id);
      void mutateRegistrations().catch(() => {});
      return true;
    } catch (registerError) {
      setControlsError(registerError instanceof Error
        ? registerError.message : 'Unable to register external tmux server.');
      return false;
    } finally {
      setControlsBusy(false);
    }
  }, [mutateRegistrations, selectServer]);

  const unregisterServer = useCallback(async (): Promise<boolean> => {
    if (!selectedServerId) return false;
    const serverId = selectedServerId;
    setControlsBusy(true);
    setControlsError(null);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(serverId)}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok && response.status !== 404) {
        throw new Error(body.error || 'Unable to unregister external tmux server.');
      }
      if (selectedServerIdRef.current === serverId) {
        setSelectedWorkspaceId(null);
        setSelectedTabId(null);
        setOptimistic(null);
      }
      await mutateCache(workspaceEndpoint(serverId), undefined, { revalidate: false });
      await mutateRegistrations(
        (current = []) => current.filter((server) => server.id !== serverId),
        { revalidate: false },
      );
      setSelectedServerPreference((current) => current === serverId ? null : current);
      void mutateRegistrations().catch(() => {});
      return true;
    } catch (unregisterError) {
      setControlsError(unregisterError instanceof Error
        ? unregisterError.message : 'Unable to unregister external tmux server.');
      return false;
    } finally {
      setControlsBusy(false);
    }
  }, [mutateCache, mutateRegistrations, selectedServerId]);

  const sourceBusy = (!registrationData && registrationsLoading)
    || (!!selectedServerId && !externalSource && sourceLoading);
  const source: IWorkspaceChromeSourceAdapter = {
    kind: 'external',
    label: selectedServer ? `External tmux · ${selectedServer.name}` : 'External tmux',
    workspaces: model.workspaces,
    groups: [],
    workspaceLayouts: model.workspaceLayouts,
    terminalTargets: Object.fromEntries([...model.targets].map(([tabId, target]) => [
      tabId, { kind: 'external' as const, ...target },
    ])),
    activeWorkspaceId,
    activePaneId,
    activeTabId: effectiveTabId,
    isCreatingTab: creating,
    isLoading: sourceBusy,
    error: mutationError
      ?? (registrationsError instanceof Error ? registrationsError.message : null)
      ?? (sourceError instanceof Error ? sourceError.message : null)
      ?? externalSource?.unavailableReason
      ?? null,
    capabilities: externalWorkspaceChromeCapabilities,
    selectWorkspace,
    selectTab,
    createTab,
    refresh: () => {
      void mutateRegistrations();
      if (selectedServerId) void mutateSource();
    },
  };

  const emptyMessage = sourceBusy
    ? 'Loading external workspaces…'
    : servers.length === 0
      ? 'No external tmux servers are registered.'
      : externalSource && !externalSource.exists
        ? externalSource.unavailableReason ?? 'The selected external tmux server is unavailable.'
        : externalSource?.workspaces.length === 0
          ? 'The selected external tmux server has no sessions.'
          : 'No external windows are available.';

  return {
    source,
    controls: {
      servers,
      selectedServerId,
      isLoading: !registrationData && registrationsLoading,
      isMutating: controlsBusy,
      error: controlsError,
      selectServer,
      registerServer,
      unregisterServer,
    },
    emptyMessage,
  };
}
