import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { GetServerSideProps } from 'next';
import useSWR from 'swr';
import type { IExtReview } from '@/types/ext-review';
import { requireAuth } from '@/lib/require-auth';
import { loadMessagesServer } from '@/lib/load-messages';

const ReviewTerminal = dynamic(() => import('@/components/features/ext-review/review-terminal'), { ssr: false });
const fetchReview = async (url: string): Promise<IExtReview> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(response.status === 404 ? 'This Review was deleted or does not exist.'
    : response.status === 409 ? 'The approved external targets are unavailable. Create a new Review explicitly if the targets changed.'
      : 'Unable to load this Review. Check your connection and authentication.');
  return response.json();
};

export default function ExtReviewPage({ id }: { id: string }) {
  const { data: review, error, mutate } = useSWR(`/api/cli/ext-reviews/${encodeURIComponent(id)}`, fetchReview, { refreshInterval: 5000, shouldRetryOnError: false });
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);
  const windowId = review?.windowIds.includes(selectedWindow ?? '') ? selectedWindow! : review?.windowIds[0];
  return (
    <div className="p-6 space-y-4">
      <Head><title>External Review · purplemux</title></Head>
      <Link href="/ext-review">External Reviews</Link>
      <h1 className="text-2xl font-semibold">External Review</h1>
      <p className="break-all">{id}</p>
      {error ? <p role="alert">{error.message} <button onClick={() => void mutate()}>Check again</button></p>
        : !review ? <p role="status">Loading Review…</p>
          : <>
            <p className="break-all">{review.socketPath} · {review.sessionId} · read-only</p>
            <nav aria-label="Approved windows" className="flex flex-wrap gap-3">{review.windowIds.map((target) => (
              <button key={target} aria-pressed={windowId === target} className="border rounded px-3 py-2" onClick={() => setSelectedWindow(target)}>{target}</button>
            ))}</nav>
            {windowId && <ReviewTerminal key={`${id}:${windowId}`} reviewId={id} windowId={windowId} />}
          </>}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = (context) => requireAuth(context,
  async () => ({ props: { id: String(context.params?.id), messages: await loadMessagesServer() } }), { skipPreflight: true });
