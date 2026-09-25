import { useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import type { GetServerSideProps } from 'next';
import useSWR from 'swr';
import type { IExternalServerInventory } from '@/types/external-server';
import type { IExternalTerminalTarget } from '@/types/terminal';
import { requireAuth } from '@/lib/require-auth';
import { loadMessagesServer } from '@/lib/load-messages';

const ExternalTerminalSurface = dynamic(
  () => import('@/components/features/workspace/external-terminal-surface'),
  { ssr: false },
);
const endpoint = '/api/cli/external-servers';
const inventoryRefreshInterval = 5000;
const fetchServers = async (): Promise<{ servers: IExternalServerInventory[] }> => {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('Unable to load external tmux servers.');
  return response.json();
};
const requestStorageKey = (serverId: string) => `purplemux-external-terminal-request:${serverId}`;

export default function ExternalServersPage() {
  const { data, error, mutate } = useSWR(endpoint, fetchServers, {
    refreshInterval: inventoryRefreshInterval,
  });
  const [selected, setSelected] = useState<IExternalTerminalTarget | null>(null);
  const [creatingServerId, setCreatingServerId] = useState<string | null>(null);
  const [creationError, setCreationError] = useState<string | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const availableTargets = useMemo(() => {
    const targets: Array<{
      target: IExternalTerminalTarget;
      serverName: string;
      sessionName: string;
      windowName: string;
    }> = [];
    const seen = new Set<string>();
    for (const server of data?.servers ?? []) {
      for (const session of server.sessions) {
        for (const window of session.windows) {
          const key = `${server.id}\0${session.id}\0${window.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          targets.push({
            target: { serverId: server.id, sessionId: session.id, windowId: window.id },
            serverName: server.name,
            sessionName: session.name,
            windowName: window.name,
          });
        }
      }
    }
    return targets;
  }, [data]);
  const active = selected && availableTargets.some(({ target }) => target.serverId === selected.serverId
    && target.sessionId === selected.sessionId && target.windowId === selected.windowId)
    ? selected : availableTargets[0]?.target;

  const createTerminal = async (serverId: string) => {
    setCreatingServerId(serverId);
    setCreationError(null);
    let storedRequestId: string | null = null;
    try { storedRequestId = sessionStorage.getItem(requestStorageKey(serverId)); } catch {}
    const requestId = requestIds.current.get(serverId) ?? storedRequestId ?? nanoid();
    requestIds.current.set(serverId, requestId);
    try { sessionStorage.setItem(requestStorageKey(serverId), requestId); } catch {}
    let body;
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(serverId)}/terminals`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      body = await response.json();
      if (!response.ok) {
        if (response.status < 500 && !body.outcomeUnknown) {
          requestIds.current.delete(serverId);
          try { sessionStorage.removeItem(requestStorageKey(serverId)); } catch {}
        }
        throw new Error(body.error || 'Unable to create external terminal.');
      }
      if (body.provenance?.requestId !== requestId) {
        throw new Error('External terminal creation outcome is unknown; retry to reconcile it.');
      }
      requestIds.current.delete(serverId);
      try { sessionStorage.removeItem(requestStorageKey(serverId)); } catch {}
    } catch (createError) {
      setCreationError(createError instanceof Error ? createError.message : 'Unable to create external terminal.');
      setCreatingServerId(null);
      return;
    }
    setSelected({ serverId, sessionId: body.sessionId, windowId: body.windowId });
    setCreatingServerId(null);
    // Creation already committed. A refresh failure must not be presented as a failed mutation.
    void mutate().catch(() => {});
  };

  return (
    <main className="mx-auto max-w-6xl p-6 space-y-5">
      <Head><title>External tmux · purplemux</title></Head>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">External tmux</h1>
          <p>Open a discovered window through the standard PurpleMux terminal.</p>
        </div>
        <button className="border rounded px-3 py-2" onClick={() => void mutate()}>Refresh</button>
      </div>
      {creationError && <p role="alert">{creationError}</p>}
      {error ? <p role="alert">{error.message}</p> : !data ? <p role="status">Loading external servers…</p>
        : <>
          {data.servers.length === 0 ? <p role="status">No external servers are registered.</p>
            : <div aria-label="External tmux servers" className="space-y-4">
              {data.servers.map((server) => <section key={server.id} aria-label={`${server.name} server`}
                className="border rounded p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">{server.name}</h2>
                    <p className="text-sm break-all">{server.socketPath}</p>
                  </div>
                  <button className="border rounded px-3 py-2"
                    disabled={!server.exists || creatingServerId !== null}
                    onClick={() => void createTerminal(server.id)}>
                    {creatingServerId === server.id ? 'Creating…' : `New Terminal on ${server.name}`}
                  </button>
                </div>
                {!server.exists
                  ? <p role="status">Unavailable: {server.unavailableReason ?? 'External tmux server is unavailable'}</p>
                  : server.sessions.length === 0 ? <p role="status">No sessions are running.</p>
                    : <div className="space-y-3">{server.sessions.map((session) => (
                      <section key={session.id} aria-label={`${server.name} / ${session.name} session`}
                        className="border rounded p-3 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="font-medium">{session.name}</h3>
                          <span className="text-sm">{session.owned ? 'Owned by PurpleMux' : 'Not owned by PurpleMux'}</span>
                        </div>
                        <nav aria-label={`${server.name} / ${session.name} windows`} className="flex flex-wrap gap-2">
                          {session.windows.map((window) => {
                            const target = { serverId: server.id, sessionId: session.id, windowId: window.id };
                            const isActive = active?.serverId === target.serverId
                              && active.sessionId === target.sessionId && active.windowId === target.windowId;
                            return <button key={window.id} aria-label={`${server.name} / ${session.name} / ${window.name}`}
                              aria-pressed={isActive} className="border rounded px-3 py-2"
                              onClick={() => setSelected(target)}>{window.name}</button>;
                          })}
                        </nav>
                      </section>
                    ))}</div>}
              </section>)}
            </div>}
          {availableTargets.length === 0 ? <p role="status">No external windows are available.</p>
            : active && <ExternalTerminalSurface key={`${active.serverId}:${active.sessionId}:${active.windowId}`}
              externalTerminalTarget={active} />}
        </>}
    </main>
  );
}

export const getServerSideProps: GetServerSideProps = (context) => requireAuth(context,
  async () => ({ props: { messages: await loadMessagesServer() } }), { skipPreflight: true });
