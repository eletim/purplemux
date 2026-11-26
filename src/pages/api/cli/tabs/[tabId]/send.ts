import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { submitTabInput, TabInputRuntimeError } from '@/lib/tab-input-runtime';
import { createLogger } from '@/lib/logger';

const log = createLogger('cli-tab-input');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const tabId = req.query.tabId as string;
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (req.body?.requireEmptyCodex !== undefined && typeof req.body.requireEmptyCodex !== 'boolean') {
    return res.status(400).json({ error: 'requireEmptyCodex must be boolean' });
  }
  try {
    await submitTabInput({ workspaceId, tabId, content: req.body?.content, requireEmptyCodex: req.body?.requireEmptyCodex });
    return res.status(200).json({ status: 'sent' });
  } catch (error) {
    if (error instanceof TabInputRuntimeError) {
      return res.status(error.status).json(error.body);
    }
    log.error(`tab submit failed: ${error instanceof Error ? error.message : error}`);
    return res.status(500).json({ error: 'Failed to send input' });
  }
};

export default handler;
