import { useState } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import type { GetServerSideProps } from 'next';
import useSWR from 'swr';
import type { IExtReview } from '@/types/ext-review';
import { requireAuth } from '@/lib/require-auth';
import { loadMessagesServer } from '@/lib/load-messages';

const ExternalTargetTerminal = dynamic(() => import('@/components/features/ext-review/external-target-terminal'), { ssr: false });
const fetchTarget = async (url: string): Promise<IExtReview> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('External target unavailable');
  const target = await response.json() as IExtReview;
  if (!target.interactive) throw new Error('External target is not registered');
  return target;
};

export default function ExternalTargetPage({ id }: { id: string }) {
  const { data: target, error } = useSWR(`/api/cli/ext-reviews/${encodeURIComponent(id)}`, fetchTarget, { shouldRetryOnError: false });
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);
  const windowId = target?.windowIds.includes(selectedWindow ?? '') ? selectedWindow! : target?.windowIds[0];
  return (
    <main className="p-6 space-y-4">
      <Head><title>External Target · purplemux</title></Head>
      <h1 className="text-2xl font-semibold">External Target</h1>
      {error ? <p role="alert">{error.message}</p> : !target ? <p role="status">Loading target…</p> : <>
        <p className="break-all">{target.socketPath} · {target.sessionId}</p>
        <nav aria-label="Registered windows" className="flex flex-wrap gap-3">{target.windowIds.map((window) => (
          <button key={window} aria-pressed={windowId === window} className="border rounded px-3 py-2" onClick={() => setSelectedWindow(window)}>{window}</button>
        ))}</nav>
        {windowId && <ExternalTargetTerminal key={`${id}:${windowId}`} targetId={id} windowId={windowId} />}
      </>}
    </main>
  );
}

export const getServerSideProps: GetServerSideProps = (context) => requireAuth(context,
  async () => ({ props: { id: String(context.params?.id), messages: await loadMessagesServer() } }), { skipPreflight: true });
