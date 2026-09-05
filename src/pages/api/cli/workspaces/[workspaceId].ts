import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';
import { deleteWorkspaceIfEmpty, getWorkspaceById } from '@/lib/workspace-store';

const singleQueryValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const workspaceId = singleQueryValue(req.query.workspaceId);
  if (!workspaceId) {
    return res.status(400).json({ error: 'workspaceId is required' });
  }

  if (req.method === 'GET') {
    const workspace = await getWorkspaceById(workspaceId);
    return res.status(200).json(workspace
      ? { workspaceId, state: 'present', workspace }
      : { workspaceId, state: 'absent', workspace: null });
  }

  if (singleQueryValue(req.query.ifEmpty) !== 'true') {
    return res.status(400).json({
      error: 'ifEmpty=true is required; unconditional workspace deletion is not available through the public CLI API',
      workspaceId,
    });
  }

  try {
    const result = await deleteWorkspaceIfEmpty(workspaceId);
    return res.status(result.status === 'not-empty' ? 409 : 200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Workspace deletion failed',
      workspaceId,
      status: 'unknown',
    });
  }
};

export default handler;
