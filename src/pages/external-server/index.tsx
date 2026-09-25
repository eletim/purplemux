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
const fetchServers = async (): Promise<{ servers: IExternalServerInventory[] }> => {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('Unable to load external tmux servers.');
  return response.json();
};
const requestStorageKey = (serverId: string) => `purplemux-external-terminal-request:${serverId}`;

export default function ExternalServersPage() {
  const { data, error, mutate } = useSWR(endpoint, fetchServers);
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
        if (response.status < 500) {
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
      {data && <div aria-label="External tmux servers" className="flex flex-wrap gap-2">
        {data.servers.map((server) => <button key={server.id} className="border rounded px-3 py-2"
          disabled={!server.exists || creatingServerId !== null}
          onClick={() => void createTerminal(server.id)}>
          {creatingServerId === server.id ? 'Creating…' : `New Terminal on ${server.name}`}
        </button>)}
      </div>}
      {creationError && <p role="alert">{creationError}</p>}
      {error ? <p role="alert">{error.message}</p> : !data ? <p role="status">Loading external servers…</p>
        : availableTargets.length === 0 ? <p role="status">No external windows are available.</p>
          : <>
            <nav aria-label="External tmux windows" className="flex flex-wrap gap-2">
              {availableTargets.map(({ target, serverName, sessionName, windowName }) => {
                const key = `${target.serverId}:${target.sessionId}:${target.windowId}`;
                const isActive = active?.serverId === target.serverId
                  && active.sessionId === target.sessionId && active.windowId === target.windowId;
                return <button key={key} aria-pressed={isActive} className="border rounded px-3 py-2"
                  onClick={() => setSelected(target)}>{serverName} / {sessionName} / {windowName}</button>;
              })}
            </nav>
            {active && <ExternalTerminalSurface key={`${active.serverId}:${active.sessionId}:${active.windowId}`}
              externalTerminalTarget={active} />}
          </>}
    </main>
  );
}

export const getServerSideProps: GetServerSideProps = (context) => requireAuth(context,
  async () => ({ props: { messages: await loadMessagesServer() } }), { skipPreflight: true });
