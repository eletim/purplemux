import os from 'os';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getWorkspaces } from '@/lib/workspace-store';
import { createWorkspaceRuntime, getWorkspaceRuntimeHttpError } from '@/lib/workspace-runtime';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    const data = await getWorkspaces();
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { directory, name, resumeSessionId, panelType } = req.body ?? {};
    const resolvedDirectory =
      directory && typeof directory === 'string' ? directory : os.homedir();

    try {
      const workspace = await createWorkspaceRuntime({
        directory: resolvedDirectory,
        name,
        resumeSessionId,
        panelType,
      });
      return res.status(200).json(workspace);
    } catch (error) {
      const result = getWorkspaceRuntimeHttpError(error);
      return res.status(result.status).json(result.body);
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
};

export default handler;
