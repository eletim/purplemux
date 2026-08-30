import type { NextApiRequest, NextApiResponse } from 'next';
import { getLayout } from '@/lib/layout-store';
import { getFirstPaneId } from '@/lib/layout-tree';
import { verifyCliToken } from '@/lib/cli-token';
import { getBrowserBridge, type IBrowserBridgeClient } from '@/lib/browser-bridge-client';
import { findTab } from '@/lib/tab-location';

export { findTab } from '@/lib/tab-location';
export type { ITabLocation } from '@/lib/tab-location';

export const resolveFirstPaneId = async (workspaceId: string): Promise<string | null> => {
  const layout = await getLayout(workspaceId);
  const paneId = getFirstPaneId(layout.root);
  return paneId || null;
};

interface IBrowserTabContext {
  tabId: string;
  bridge: IBrowserBridgeClient;
}

export const withBrowserTab = async (
  req: NextApiRequest,
  res: NextApiResponse,
  method: 'GET' | 'POST',
  handler: (ctx: IBrowserTabContext) => Promise<void> | void,
): Promise<void> => {
  if (req.method !== method) {
    res.setHeader('Allow', method);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!verifyCliToken(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const tabId = req.query.tabId as string;
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  if (!workspaceId) {
    res.status(400).json({ error: 'workspaceId is required' });
    return;
  }
  const found = await findTab(workspaceId, tabId);
  if (!found) {
    res.status(404).json({ error: 'Tab not found' });
    return;
  }
  if (found.tab.panelType !== 'web-browser') {
    res.status(400).json({ error: 'Tab is not a web-browser panel' });
    return;
  }
  const bridge = getBrowserBridge();
  if (!bridge) {
    res.status(503).json({ error: 'Browser bridge unavailable (Electron-only feature)' });
    return;
  }
  await handler({ tabId, bridge });
};
