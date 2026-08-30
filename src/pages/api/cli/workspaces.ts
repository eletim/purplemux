import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getWorkspaces } from '@/lib/workspace-store';
import { verifyCliToken } from '@/lib/cli-token';
import { createWorkspaceRuntime, getWorkspaceRuntimeHttpError } from '@/lib/workspace-runtime';

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method === 'GET') {
    const { workspaces } = await getWorkspaces();
    const result = workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      directories: ws.directories,
    }));
    return res.status(200).json({ workspaces: result });
  }

  const { cwd, name } = req.body ?? {};
  if (typeof cwd !== 'string' || cwd.trim().length === 0) {
    return res.status(400).json({ error: 'cwd is required' });
  }
  if (!path.isAbsolute(cwd)) {
    return res.status(400).json({ error: 'cwd must be an absolute path' });
  }
  if (name !== undefined && typeof name !== 'string') {
    return res.status(400).json({ error: 'name must be a string' });
  }

  try {
    const workspace = await createWorkspaceRuntime({ directory: cwd, name });
    return res.status(201).json(workspace);
  } catch (error) {
    const result = getWorkspaceRuntimeHttpError(error);
    return res.status(result.status).json(result.body);
  }
};

export default handler;
