import type { NextApiRequest, NextApiResponse } from 'next';
import { getLayout, patchLayout, readExistingLayout } from '@/lib/layout-store';
import { getActiveWorkspaceId, getWorkspaceById } from '@/lib/workspace-store';
import { createLogger } from '@/lib/logger';

const log = createLogger('layout');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const wsId = (req.query.workspace as string) || await getActiveWorkspaceId();
  if (!wsId) {
    return res.status(400).json({ error: 'No workspace found' });
  }

  if (req.method === 'GET') {
    try {
      if (req.query.readOnly === 'true') {
        const layout = await readExistingLayout(wsId);
        return res.status(200).json(layout);
      }
      const ws = await getWorkspaceById(wsId);
      const layout = await getLayout(wsId, ws?.directories[0]);
      return res.status(200).json(layout);
    } catch (err) {
      log.error(`GET failed: ${err instanceof Error ? err.message : err}`);
      return res.status(500).json({ error: 'Failed to load layout' });
    }
  }

  if (req.method === 'PATCH') {
    const { activePaneId, ratioUpdate, equalize, diffSettings } = req.body ?? {};
    const result = await patchLayout(wsId, { activePaneId, ratioUpdate, equalize, diffSettings });
    if (!result) {
      return res.status(404).json({ error: 'Target not found' });
    }
    return res.status(200).json(result);
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;
