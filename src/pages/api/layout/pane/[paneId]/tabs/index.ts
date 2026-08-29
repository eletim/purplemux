import type { NextApiRequest, NextApiResponse } from 'next';
import { getActiveWorkspaceId } from '@/lib/workspace-store';
import { createTabRuntime, TabRuntimeError } from '@/lib/tab-runtime';
import { createLogger } from '@/lib/logger';

const log = createLogger('layout');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const wsId = (req.query.workspace as string) || await getActiveWorkspaceId();
  if (!wsId) {
    return res.status(400).json({ error: 'No workspace found' });
  }

  const paneId = req.query.paneId as string;
  const { name, cwd, panelType, resumeSessionId } = req.body ?? {};

  try {
    const { tab } = await createTabRuntime({
      workspaceId: wsId,
      paneId,
      name,
      cwd,
      panelType,
      resumeSessionId,
    });
    return res.status(200).json(tab);
  } catch (err) {
    if (err instanceof TabRuntimeError) {
      return res.status(err.status).json(err.body);
    }
    log.error(`tab creation failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'Failed to create tab' });
  }
};

export default handler;
