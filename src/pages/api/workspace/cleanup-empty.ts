import type { NextApiRequest, NextApiResponse } from 'next';
import { deleteWorkspaceIfEmpty } from '@/lib/workspace-store';
import type { IWorkspaceCleanupResponse, TWorkspaceCleanupItemResult } from '@/types/workspace-cleanup';

const handler = async (
  req: NextApiRequest,
  res: NextApiResponse<IWorkspaceCleanupResponse | { error: string }>,
) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const workspaceIds = req.body?.workspaceIds;
  if (
    !Array.isArray(workspaceIds)
    || !workspaceIds.every((workspaceId) => typeof workspaceId === 'string' && workspaceId.length > 0)
  ) {
    return res.status(400).json({ error: 'workspaceIds must be an array of non-empty strings' });
  }

  const uniqueWorkspaceIds = [...new Set<string>(workspaceIds)];
  const results: TWorkspaceCleanupItemResult[] = [];
  for (const workspaceId of uniqueWorkspaceIds) {
    try {
      results.push(await deleteWorkspaceIfEmpty(workspaceId));
    } catch (error) {
      results.push({
        workspaceId,
        status: 'error',
        deleted: false,
        error: error instanceof Error ? error.message : 'Workspace deletion failed',
      });
    }
  }

  return res.status(200).json({ results });
};

export default handler;
