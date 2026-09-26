import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyRequestSession } from '@/lib/auth';
import { verifyCliToken } from '@/lib/cli-token';
import { ExternalServerError, ExternalWindowOutcomeUnknownError } from '@/lib/external-server-tmux';
import { createExternalWorkspaceTab } from '@/lib/external-workspace-adapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const authed = verifyCliToken(req) || (await verifyRequestSession(req.headers.cookie));
  if (!authed) return res.status(403).json({ error: 'Forbidden' });
  const { serverId, workspaceId } = req.query;
  if (typeof serverId !== 'string') return res.status(400).json({ error: 'serverId is required' });
  if (typeof workspaceId !== 'string' || !/^\$\d+$/.test(workspaceId)) {
    return res.status(400).json({ error: 'A stable workspaceId is required' });
  }
  const { sessionCreated, requestId } = req.body ?? {};
  if (typeof sessionCreated !== 'string' || !/^\d+$/.test(sessionCreated)) {
    return res.status(400).json({ error: 'sessionCreated is required' });
  }
  if (typeof requestId !== 'string' || !/^[-_A-Za-z0-9]{1,128}$/.test(requestId)) {
    return res.status(400).json({ error: 'requestId is required' });
  }
  try {
    const tab = await createExternalWorkspaceTab(serverId,
      { id: workspaceId, sessionCreated, requestId });
    return tab
      ? res.status(201).json(tab)
      : res.status(404).json({ error: 'External server not found' });
  } catch (error) {
    if (error instanceof ExternalWindowOutcomeUnknownError) {
      return res.status(503).json({
        error: error.message,
        outcomeUnknown: true,
        requestId: error.requestId,
      });
    }
    return res.status(error instanceof ExternalServerError ? 409 : 500).json({
      error: error instanceof ExternalServerError ? error.message : 'Failed to create external tab',
    });
  }
}
