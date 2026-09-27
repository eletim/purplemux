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

export const sendExternalInput = async (backend: TmuxTarget, target: string, data: Uint8Array,
  signal: AbortSignal, webInput = false): Promise<void> => {
  if (webInput) {
    await execTmux(backend, ['copy-mode', '-q', '-t', target], { timeout: 5000, signal }).catch(async () => {
      // Missing copy mode is harmless, but a replaced external socket is not.
      await validateTmuxTarget(backend, signal);
    });
  }
  // -H sends bytes to the exact target pane, without feeding tmux client keys.
  for (let offset = 0; offset < data.length; offset += 1024) {
    const bytes = data.subarray(offset, offset + 1024);
    await execTmux(backend, ['send-keys', '-H', '-t', target,
      ...Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))], { timeout: 5000, signal });
    await validateTmuxTarget(backend, signal);
  }
};
