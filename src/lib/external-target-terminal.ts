import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCallback);

export const sendExternalInput = async (socketPath: string, target: string, data: Uint8Array,
  signal: AbortSignal): Promise<void> => {
  // -H sends bytes to the exact target pane, without feeding tmux client keys.
  for (let offset = 0; offset < data.length; offset += 1024) {
    signal.throwIfAborted();
    const bytes = data.subarray(offset, offset + 1024);
    await execFile('tmux', ['-N', '-S', socketPath, 'send-keys', '-H', '-t', target,
      ...Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))], { timeout: 5000, signal });
  }
};

export const isExternalClientOnWindow = async (socketPath: string, pid: number, windowId: string): Promise<boolean> => {
  const { stdout } = await execFile('tmux', ['-N', '-S', socketPath, 'list-clients', '-F',
    '#{client_pid}\t#{window_id}'], { timeout: 5000 });
  return stdout.trim().split('\n').some((line) => line === `${pid}\t${windowId}`);
};
