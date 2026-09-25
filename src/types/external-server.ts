export interface IRegisterExternalServer {
  name: string;
  socketPath: string;
}

export interface IExternalServer {
  id: string;
  name: string;
  socketPath: string;
  socketIdentity: string;
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
  exists: true;
  attached: boolean;
  windows: IExternalTmuxWindow[];
}

/** A registration combined with a fresh, non-persisted tmux runtime snapshot. */
export interface IExternalServerInventory extends IExternalServer {
  exists: boolean;
  sessions: IExternalTmuxSession[];
  unavailableReason?: string;
}
