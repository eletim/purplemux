import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { launchInitialCodex, readInitialLaunch } from '@/lib/codex-initial-launch';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifyCliToken(req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (req.method === 'POST') return res.status(200).json(await launchInitialCodex(req.body));
    if (req.method === 'GET' && typeof req.query.operationId === 'string') return res.status(200).json(await readInitialLaunch(req.query.operationId));
    return res.status(405).json({ error: 'GET or POST required' });
  } catch { return res.status(409).json({ error: 'Initial launch unavailable or uncertain; query only, never resend' }); }
}
