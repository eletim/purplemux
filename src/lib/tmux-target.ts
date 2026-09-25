import {
  execFile as execFileCallback,
  spawn,
  type ChildProcess,
  type ExecFileOptionsWithBufferEncoding,
  type ExecFileOptionsWithStringEncoding,
  type SpawnOptions,
} from 'child_process';
import * as pty from 'node-pty';

const MANAGED_SOCKET = 'purple';

export interface IManagedTmuxTarget {
  kind: 'managed';
}

export interface IExternalTmuxTarget {
  kind: 'external';
  socketPath: string;
  validate: (signal?: AbortSignal) => Promise<void>;
}

export type TmuxTarget = IManagedTmuxTarget | IExternalTmuxTarget;

export const managedTmuxTarget: IManagedTmuxTarget = Object.freeze({ kind: 'managed' });

export const externalTmuxTarget = (
  socketPath: string,
  validate: (signal?: AbortSignal) => Promise<void>,
): IExternalTmuxTarget => ({ kind: 'external', socketPath, validate });

/** Keep backend selection here so terminal callers operate on a target, not a socket flag. */
const tmuxTargetArgs = (target: TmuxTarget, args: string[]): string[] => [
  ...(target.kind === 'managed'
    ? ['-L', MANAGED_SOCKET]
    : ['-N', '-S', target.socketPath]),
  ...args,
];

export const validateTmuxTarget = async (target: TmuxTarget, signal?: AbortSignal): Promise<void> => {
  signal?.throwIfAborted();
  if (target.kind === 'external') await target.validate(signal);
  signal?.throwIfAborted();
};

type TmuxExecOptions = Omit<ExecFileOptionsWithStringEncoding, 'encoding'>;
type TmuxBufferExecOptions = Omit<ExecFileOptionsWithBufferEncoding, 'encoding'>;

/** Execute against a managed or validated external target without exposing selector flags. */
export const execTmux = async (
  target: TmuxTarget,
  args: string[],
  options: TmuxExecOptions = {},
): Promise<{ stdout: string; stderr: string }> => {
  await validateTmuxTarget(target, options.signal);
  let child!: ChildProcess;
  const result = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    child = execFileCallback('tmux', tmuxTargetArgs(target, args),
      { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
  });
  // The child can fail while an asynchronous identity check is still pending.
  void result.catch(() => {});
  try {
    // Detect a path replacement in the gap between validation and process creation.
    await validateTmuxTarget(target, options.signal);
  } catch (error) {
    child.kill();
    await result.catch(() => {});
    throw error;
  }
  return result;
};

/** Execute against a target while preserving arbitrary bytes in tmux output. */
export const execTmuxBuffer = async (
  target: TmuxTarget,
  args: string[],
  options: TmuxBufferExecOptions = {},
): Promise<{ stdout: Buffer; stderr: Buffer }> => {
  await validateTmuxTarget(target, options.signal);
  let child!: ChildProcess;
  const result = new Promise<{ stdout: Buffer; stderr: Buffer }>((resolve, reject) => {
    child = execFileCallback('tmux', tmuxTargetArgs(target, args),
      { ...options, encoding: 'buffer' }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
  });
  void result.catch(() => {});
  try {
    await validateTmuxTarget(target, options.signal);
  } catch (error) {
    child.kill();
    await result.catch(() => {});
    throw error;
  }
  return result;
};

export const spawnTmux = async (
  target: TmuxTarget,
  args: string[],
  options: SpawnOptions = {},
): Promise<ChildProcess> => {
  await validateTmuxTarget(target, options.signal);
  const child = spawn('tmux', tmuxTargetArgs(target, args), options);
  try {
    await validateTmuxTarget(target, options.signal);
    return child;
  } catch (error) {
    child.kill();
    throw error;
  }
};

export const attachTmuxPty = async (
  target: TmuxTarget,
  sessionName: string,
  options: pty.IPtyForkOptions,
  settings: {
    controlMode?: boolean;
    noOutput?: boolean;
    readOnly?: boolean;
    signal?: AbortSignal;
    onSpawn?: (client: pty.IPty) => void;
  } = {},
): Promise<pty.IPty> => {
  await validateTmuxTarget(target, settings.signal);
  const externalFlags = settings.noOutput ? 'read-only,ignore-size,no-output' : 'read-only,ignore-size';
  const controlMode = settings.controlMode ?? target.kind === 'external';
  const client = pty.spawn('tmux', tmuxTargetArgs(target, controlMode
    ? ['-u', '-C', 'attach-session', '-f', externalFlags, '-t', sessionName]
    : ['-u', 'attach-session', ...(settings.readOnly ? ['-r'] : []), '-t', sessionName]), options);
  // Control clients must subscribe before node-pty can emit initial protocol events.
  settings.onSpawn?.(client);
  try {
    await validateTmuxTarget(target, settings.signal);
    return client;
  } catch (error) {
    client.kill();
    throw error;
  }
};
