import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { findTab } from '@/lib/cli-utils';
import { getProviderByPanelType } from '@/lib/providers';
import { closeTabRuntime, TabRuntimeError } from '@/lib/tab-runtime';
import { createLogger } from '@/lib/logger';

const log = createLogger('cli');

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const tabId = req.query.tabId as string;
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;

  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (req.method === 'GET') {
    const found = await findTab(workspaceId, tabId);
    if (!found) return res.status(404).json({ error: 'Tab not found' });
    const provider = getProviderByPanelType(found.tab.panelType);
    return res.status(200).json({
      tabId: found.tab.id,
      workspaceId: found.workspaceId,
      paneId: found.paneId,
      name: found.tab.name,
      sessionName: found.tab.sessionName,
      panelType: found.tab.panelType,
      agentProviderId: provider?.id ?? null,
      agentSessionId: provider?.readSessionId(found.tab) ?? null,
    });
  }

  if (req.method === 'DELETE') {
    try {
      await closeTabRuntime({ workspaceId, tabId });
      return res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof TabRuntimeError) {
        return res.status(err.status).json(err.body);
      }
      log.error(`CLI tab close failed: ${err instanceof Error ? err.message : err}`);
      return res.status(500).json({ error: 'Failed to close tab' });
    }
  }

  res.setHeader('Allow', 'GET, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;
