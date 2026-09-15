import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { deleteExtReview, getExtReview } from '@/lib/ext-review-store';
import { ExtReviewError } from '@/lib/ext-review-tmux';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCliToken(req)) return res.status(403).json({ error: 'Forbidden' });
  const { reviewId } = req.query;
  if (typeof reviewId !== 'string') return res.status(400).json({ error: 'reviewId is required' });
  try {
    if (req.method === 'DELETE') {
      return await deleteExtReview(reviewId)
        ? res.status(200).json({ deleted: true }) : res.status(404).json({ error: 'Review not found' });
    }
    const review = await getExtReview(reviewId);
    return review ? res.status(200).json(review) : res.status(404).json({ error: 'Review not found' });
  } catch (error) {
    return res.status(error instanceof ExtReviewError ? 409 : 500)
      .json({ error: error instanceof ExtReviewError ? error.message : 'Failed to access review definition' });
  }
}
