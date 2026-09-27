import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyRequestSession } from '@/lib/auth';
import { verifyCliToken } from '@/lib/cli-token';
import { unregisterExternalServer } from '@/lib/external-server-store';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const authed = verifyCliToken(req) || (await verifyRequestSession(req.headers.cookie));
  if (!authed) return res.status(403).json({ error: 'Forbidden' });
  const { serverId } = req.query;
  if (typeof serverId !== 'string') return res.status(400).json({ error: 'serverId is required' });
  try {
    return await unregisterExternalServer(serverId)
      ? res.status(200).json({ deleted: true })
      : res.status(404).json({ error: 'External server not found' });
  } catch {
    return res.status(500).json({ error: 'Failed to access external server registration' });
  }
}
