import type { NextApiRequest, NextApiResponse } from 'next';
import { submitTabInput, TabInputRuntimeError } from '@/lib/tab-input-runtime';
import { createLogger } from '@/lib/logger';

const log = createLogger('tab-input');

// The composer previously used the terminal WebSocket, whose default payload
// ceiling is 100 MiB. Keep that effective contract when moving submit to HTTP.
export const config = {
  api: { bodyParser: { sizeLimit: '100mb' } },
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });

  try {
    await submitTabInput({
      workspaceId,
      tabId: req.query.tabId as string,
      content: req.body?.content,
    });
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
