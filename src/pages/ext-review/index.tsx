import { useState, type FormEvent } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import useSWR from 'swr';
import type { IExtReview } from '@/types/ext-review';
import { requireAuth } from '@/lib/require-auth';
import { loadMessagesServer } from '@/lib/load-messages';

const endpoint = '/api/cli/ext-reviews';
const fetchReviews = async () => {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('Unable to load Reviews. Check your connection and authentication.');
  return response.json() as Promise<{ reviews: IExtReview[] }>;
};

export default function ExtReviewsPage() {
  const { data, error, mutate } = useSWR(endpoint, fetchReviews);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socketPath: fields.get('socketPath'), session: fields.get('session'),
          windowTargets: String(fields.get('windowTargets')).trim().split(/[\s,]+/) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to create Review');
      form.reset();
      setMessage(`Created Review ${result.id}.`);
      await mutate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create Review');
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error('Unable to delete Review');
      setMessage(response.status === 404 ? 'This Review was already deleted.' : 'Review definition deleted.');
      await mutate();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete Review');
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <Head><title>External Reviews · purplemux</title></Head>
      <h1 className="text-2xl font-semibold">External Reviews</h1>
      <p>Observe explicitly approved external tmux windows. Reviews are independent of Workspaces; deleting a Review removes only its definition.</p>
      <form onSubmit={create} className="space-y-3 border rounded p-4">
        <h2 className="text-lg font-semibold">Create Review</h2>
        <p className="text-sm">Enter known targets manually. No socket, session, or window discovery is performed.</p>
        <label className="block">Absolute socket path<input name="socketPath" required pattern="/.*" placeholder="/absolute/path/to/tmux/socket" className="block w-full border rounded p-2" /></label>
        <label className="block">Exact session name or $sessionId<input name="session" required className="block w-full border rounded p-2" /></label>
        <label className="block">Approved @window IDs (spaces or commas)<input name="windowTargets" required placeholder="@1 @3" className="block w-full border rounded p-2" /></label>
        <button disabled={busy} className="border rounded px-3 py-2">Create Review</button>
      </form>
      {message && <p role="status">{message}</p>}
      {error ? <p role="alert">{error.message} <button onClick={() => void mutate()}>Retry</button></p>
        : !data ? <p role="status">Loading Reviews…</p>
          : data.reviews.length === 0 ? <p>No Reviews yet.</p>
            : <ul className="space-y-3">{data.reviews.map((review) => (
              <li key={review.id} className="border rounded p-4 space-y-2">
                <p className="break-all">{review.id} · {review.socketPath} · {review.sessionId}</p>
                <p>Approved windows: {review.windowIds.join(', ')}</p>
                <p className="text-sm">Created {review.createdAt}. Availability is checked when opened.</p>
                <div className="flex gap-4"><Link href={`/ext-review/${encodeURIComponent(review.id)}`}>Open</Link><button disabled={busy} onClick={() => void remove(review.id)}>Delete</button></div>
              </li>
            ))}</ul>}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = (context) => requireAuth(context,
  async () => ({ props: { messages: await loadMessagesServer() } }), { skipPreflight: true });
