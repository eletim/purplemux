import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyRequestSession } from '@/lib/auth';
import { verifyCliToken } from '@/lib/cli-token';
import { ExternalServerError } from '@/lib/external-server-tmux';
import { listExternalServers, registerExternalServer } from '@/lib/external-server-store';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const authed = verifyCliToken(req) || (await verifyRequestSession(req.headers.cookie));
  if (!authed) return res.status(403).json({ error: 'Forbidden' });
  try {
    if (req.method === 'GET') return res.status(200).json({ servers: await listExternalServers() });
    const server = await registerExternalServer({ name: req.body?.name, socketPath: req.body?.socketPath });
    return res.status(201).json(server);
  } catch (error) {
    return res.status(error instanceof ExternalServerError ? 400 : 500).json({
      error: error instanceof ExternalServerError ? error.message : 'Failed to access external server registrations',
    });
  }
}
