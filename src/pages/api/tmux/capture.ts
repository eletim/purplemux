import type { NextApiRequest, NextApiResponse } from 'next';
import { capturePaneContent, hasSession } from '@/lib/tmux';
import { createLogger } from '@/lib/logger';
import { getExternalServer } from '@/lib/external-server-store';
import { captureExternalServerWindow, ExternalServerError } from '@/lib/external-server-tmux';

const log = createLogger('tmux');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = typeof req.query.session === 'string' ? req.query.session : undefined;
  const externalServerId = typeof req.query.externalServerId === 'string'
    ? req.query.externalServerId : undefined;
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
  const windowId = typeof req.query.windowId === 'string' ? req.query.windowId : undefined;
  const external = externalServerId || sessionId || windowId;
  if ((!session && !external) || (session && external)
    || (external && (!externalServerId || !sessionId || !windowId))) {
    return res.status(400).json({ error: 'Specify one managed or external terminal target' });
  }

  if (session) {
    const exists = await hasSession(session);
    if (!exists) return res.status(404).json({ error: 'Session not found' });

    try {
      const content = await capturePaneContent(session);
      return res.status(200).json({ content: content ?? '' });
    } catch (err) {
      log.error(`capture failed: ${err instanceof Error ? err.message : err}`);
      return res.status(500).json({ error: 'Failed to capture pane' });
    }
  }

  try {
    const server = await getExternalServer(externalServerId!);
    if (!server) return res.status(404).json({ error: 'External server not found' });
    const content = await captureExternalServerWindow(server, sessionId!, windowId!);
    return res.status(200).json({ content });
  } catch (err) {
    log.error(`external capture failed: ${err instanceof Error ? err.message : err}`);
    return res.status(err instanceof ExternalServerError ? 409 : 500)
      .json({ error: err instanceof ExternalServerError ? err.message : 'Failed to capture pane' });
  }
};

export default handler;
