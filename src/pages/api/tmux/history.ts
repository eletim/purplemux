import type { NextApiRequest, NextApiResponse } from 'next';
import { capturePaneContentWithHistory, hasSession } from '@/lib/tmux';
import { createLogger } from '@/lib/logger';

const log = createLogger('tmux');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = typeof req.query.session === 'string' ? req.query.session : undefined;
  if (!session) {
    return res.status(400).json({ error: 'session parameter required' });
  }

  if (!(await hasSession(session))) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const content = await capturePaneContentWithHistory(session, 'all', { joinWrapped: true });
    if (content === null) {
      return res.status(500).json({ error: 'Failed to capture pane history' });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ content });
  } catch (err) {
    log.error(`history capture failed: ${err instanceof Error ? err.message : err}`);
    return res.status(500).json({ error: 'Failed to capture pane history' });
  }
};

export default handler;
