/** Explicit targets only: an absolute socket path, exact session name or $id,
 * and a nonempty allowlist of tmux @window IDs. No Workspace/tab ownership. */
export interface ICreateExtReview {
  socketPath: string;
  session: string;
  windowTargets: string[];
  interactive?: boolean;
}

export interface IExtReview {
  id: string;
  createdAt: string;
  socketPath: string;
  socketIdentity: string;
  serverPid: string;
  sessionId: string;
  sessionCreated: string;
  windowIds: string[];
  interactive?: boolean;
}
