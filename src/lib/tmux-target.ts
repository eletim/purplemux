import {
  execFile as execFileCallback,
  spawn,
  type ChildProcess,
  type ExecFileOptionsWithStringEncoding,
  type SpawnOptions,
} from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCallback);

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
export const tmuxTargetArgs = (target: TmuxTarget, args: string[]): string[] => [
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

/** Execute against a managed or validated external target without exposing selector flags. */
export const execTmux = async (
  target: TmuxTarget,
  args: string[],
  options: TmuxExecOptions = {},
): Promise<{ stdout: string; stderr: string }> => {
  await validateTmuxTarget(target, options.signal);
  const result = await execFile('tmux', tmuxTargetArgs(target, args), { ...options, encoding: 'utf8' });
  await validateTmuxTarget(target, options.signal);
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

export const tmuxAttachArgs = (
  target: TmuxTarget,
  sessionName: string,
  settings: { noOutput?: boolean } = {},
): string[] => {
  const externalFlags = settings.noOutput ? 'read-only,ignore-size,no-output' : 'read-only,ignore-size';
  return tmuxTargetArgs(target, target.kind === 'external'
    ? ['-u', '-C', 'attach-session', '-f', externalFlags, '-t', sessionName]
    : ['-u', 'attach-session', '-t', sessionName]);
};
