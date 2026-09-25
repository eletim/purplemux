import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyRequestSession } from '@/lib/auth';
import { verifyCliToken } from '@/lib/cli-token';
import { createExternalTerminal } from '@/lib/external-server-store';
import { ExternalServerError } from '@/lib/external-server-tmux';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const authed = verifyCliToken(req) || (await verifyRequestSession(req.headers.cookie));
  if (!authed) return res.status(403).json({ error: 'Forbidden' });
  const { serverId } = req.query;
  if (typeof serverId !== 'string') return res.status(400).json({ error: 'serverId is required' });
  try {
    const terminal = await createExternalTerminal(serverId, { name: req.body?.name });
    return terminal
      ? res.status(201).json(terminal)
      : res.status(404).json({ error: 'External server not found' });
  } catch (error) {
    return res.status(error instanceof ExternalServerError ? 400 : 500).json({
      error: error instanceof ExternalServerError
        ? error.message : 'Failed to persist external terminal ownership',
    });
  }
}
