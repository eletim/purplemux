import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { createExtReview, listExtReviews } from '@/lib/ext-review-store';
import { ExtReviewError } from '@/lib/ext-review-tmux';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCliToken(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (req.method === 'GET') return res.status(200).json({ reviews: await listExtReviews() });
    return res.status(201).json(await createExtReview(req.body));
  } catch (error) {
    return res.status(error instanceof ExtReviewError ? 400 : 500)
      .json({ error: error instanceof ExtReviewError ? error.message : 'Failed to access review definitions' });
  }
}
