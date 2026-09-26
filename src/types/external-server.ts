export interface IRegisterExternalServer {
  name: string;
  socketPath: string;
}

export interface IExternalServer {
  id: string;
  name: string;
  socketPath: string;
  socketIdentity: string;
  /** Idempotency/audit records only; live ownership comes exclusively from the tmux marker. */
  terminalCreations?: IExternalTerminalProvenance[];
}

export interface IExternalTerminalProvenance {
  id: string;
  requestId?: string;
  owner: 'purplemux';
  resourceType: 'session';
  sessionId: string;
  sessionCreated: string;
  createdAt: string;
}

export interface ICreateExternalTerminal {
  requestId: string;
  name?: string;
}

export interface ICreatedExternalTerminal {
  serverId: string;
  sessionId: string;
  sessionCreated: string;
  windowId: string;
  name: string;
  provenance: IExternalTerminalProvenance;
}

/** Exact identities returned after adding an unowned window to an existing external session. */
export interface ICreatedExternalWindow {
  serverId: string;
  sessionId: string;
  sessionCreated: string;
  windowId: string;
  requestId: string;
}

export interface IExternalTmuxPane {
  id: string;
  index: number;
  exists: true;
  active: boolean;
  pid: number;
  currentCommand: string;
  currentPath: string;
  dead: boolean;
}

export interface IExternalTmuxWindow {
  id: string;
  name: string;
  index: number;
  exists: true;
  active: boolean;
  panes: IExternalTmuxPane[];
}

export interface IExternalTmuxSession {
  id: string;
  name: string;
  sessionCreated: string;
  exists: true;
  attached: boolean;
  owned: boolean;
  provenance?: IExternalTerminalProvenance;
  windows: IExternalTmuxWindow[];
}

/** A registration combined with a fresh, non-persisted tmux runtime snapshot. */
export interface IExternalServerInventory extends IExternalServer {
  exists: boolean;
  sessions: IExternalTmuxSession[];
  unavailableReason?: string;
}
