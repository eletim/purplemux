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
