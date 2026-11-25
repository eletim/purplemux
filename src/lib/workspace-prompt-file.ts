import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '@/lib/logger';

const log = createLogger('workspace-prompt');

/** The generated context owns a prefix, never callers' appended instructions. */
export const ensureWorkspacePromptFile = async (filePath: string, body: string, workspaceId: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    if (existing.startsWith(body)) return;
    // Unknown edits or an older template cannot be separated safely. A startup
    // contract must not silently disappear when the server process restarts.
    log.warn({ workspaceId, filePath }, 'Preserving customized workspace prompt; template update requires explicit reconciliation');
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    // A concurrent writer may install a contract after the missing-file read.
    await fs.writeFile(filePath, body, { encoding: 'utf-8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
};
