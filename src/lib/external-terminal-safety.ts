import { execTmux, validateTmuxTarget, type TmuxTarget } from '@/lib/tmux-target';

const EXTERNAL_HISTORY_MAX_BUFFER = 64 * 1024 * 1024;

export const deleteExternalHistoryBuffer = async (
  backend: TmuxTarget,
  bufferName: string,
): Promise<void> => {
  await execTmux(backend, ['delete-buffer', '-b', bufferName], { timeout: 5000 }).catch(() => {});
};

export const readExternalHistoryBuffer = async (
  backend: TmuxTarget,
  bufferName: string,
  signal?: AbortSignal,
): Promise<string> => {
  try {
    const { stdout } = await execTmux(backend, ['show-buffer', '-b', bufferName], {
      timeout: 5000,
      maxBuffer: EXTERNAL_HISTORY_MAX_BUFFER,
      signal,
    });
    await validateTmuxTarget(backend, signal);
    return stdout.replaceAll('\n', '\r\n');
  } finally {
    await deleteExternalHistoryBuffer(backend, bufferName);
  }
};
