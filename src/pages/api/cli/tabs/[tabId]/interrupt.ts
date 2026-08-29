import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { interruptTab, TabInputRuntimeError } from '@/lib/tab-input-runtime';
import { createLogger } from '@/lib/logger';

const log = createLogger('cli-tab-input');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCliToken(req)) return res.status(403).json({ error: 'Forbidden' });
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });

  try {
    await interruptTab({ workspaceId, tabId: req.query.tabId as string });
    return res.status(200).json({ status: 'interrupted' });
  } catch (error) {
    if (error instanceof TabInputRuntimeError) {
      return res.status(error.status).json(error.body);
    }
    log.error(`tab interrupt failed: ${error instanceof Error ? error.message : error}`);
    return res.status(500).json({ error: 'Failed to interrupt tab' });
  }
};

export default handler;
