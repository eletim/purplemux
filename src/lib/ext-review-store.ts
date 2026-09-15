import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { nanoid } from 'nanoid';
import { freezeExtReviewTargets, resolveExtReviewTargets } from '@/lib/ext-review-tmux';
import type { ICreateExtReview, IExtReview } from '@/types/ext-review';

const file = path.join(os.homedir(), '.purplemux', 'ext-reviews.json');
const globalStore = globalThis as typeof globalThis & { __purplemuxExtReviewLock?: Promise<void> };
const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  const previous = globalStore.__purplemuxExtReviewLock ?? Promise.resolve();
  let release!: () => void;
  globalStore.__purplemuxExtReviewLock = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
};

const read = async (): Promise<IExtReview[]> => {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(data)) throw new Error('Invalid ext-review definitions');
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};
const write = async (reviews: IExtReview[]): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${nanoid()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(reviews, null, 2), { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
};

export const listExtReviews = (): Promise<IExtReview[]> => withLock(read);
export const createExtReview = (input: ICreateExtReview): Promise<IExtReview> => withLock(async () => {
  const targets = await freezeExtReviewTargets(input);
  const reviews = await read();
  const review = { ...targets, id: nanoid(), createdAt: new Date().toISOString() };
  await write([...reviews, review]);
  return review;
});
export const getExtReview = async (id: string): Promise<IExtReview | null> => {
  const review = (await listExtReviews()).find((entry) => entry.id === id);
  return review ? resolveExtReviewTargets(review) : null;
};
/** Definition-only deletion, including when the external server is unavailable. */
export const deleteExtReview = (id: string): Promise<boolean> => withLock(async () => {
  const reviews = await read();
  const remaining = reviews.filter((review) => review.id !== id);
  if (remaining.length === reviews.length) return false;
  await write(remaining);
  return true;
});
