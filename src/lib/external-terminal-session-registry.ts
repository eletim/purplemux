export const EXTERNAL_TERMINAL_SESSION_OPTION = '@purplemux_internal_external_client';

export interface IExternalTerminalSessionRegistration {
  socketPath: string;
  socketIdentity: string;
  sessionName: string;
  marker: string;
  sessionId?: string;
}

const globalStore = globalThis as unknown as {
  __purplemux_external_terminal_sessions?: Map<string, Map<string, Map<string,
    IExternalTerminalSessionRegistration>>>;
};
const registeredSessions = globalStore.__purplemux_external_terminal_sessions ??= new Map();

const registrationsFor = (
  socketPath: string,
  socketIdentity: string,
): Map<string, IExternalTerminalSessionRegistration> | undefined =>
  registeredSessions.get(socketPath)?.get(socketIdentity);

export const registerExternalTerminalSession = (
  registration: IExternalTerminalSessionRegistration,
): IExternalTerminalSessionRegistration => {
  let identities = registeredSessions.get(registration.socketPath);
  if (!identities) {
    identities = new Map();
    registeredSessions.set(registration.socketPath, identities);
  }
  let sessions = identities.get(registration.socketIdentity);
  if (!sessions) {
    sessions = new Map();
    identities.set(registration.socketIdentity, sessions);
  }
  if (sessions.has(registration.sessionName)) {
    throw new Error('External terminal client session is already registered');
  }
  sessions.set(registration.sessionName, registration);
  return registration;
};

export const bindExternalTerminalSession = (
  registration: IExternalTerminalSessionRegistration,
  sessionId: string,
): void => {
  if (registrationsFor(registration.socketPath, registration.socketIdentity)
    ?.get(registration.sessionName) !== registration) {
    throw new Error('External terminal client session is not registered');
  }
  registration.sessionId = sessionId;
};

export const unregisterExternalTerminalSession = (
  registration: IExternalTerminalSessionRegistration,
): void => {
  const identities = registeredSessions.get(registration.socketPath);
  const sessions = identities?.get(registration.socketIdentity);
  if (sessions?.get(registration.sessionName) !== registration) return;
  sessions.delete(registration.sessionName);
  if (sessions.size === 0) identities?.delete(registration.socketIdentity);
  if (identities?.size === 0) registeredSessions.delete(registration.socketPath);
};

export const registeredExternalTerminalSessions = (
  socketPath: string,
  socketIdentity: string,
): ReadonlyArray<Readonly<IExternalTerminalSessionRegistration>> =>
  [...(registrationsFor(socketPath, socketIdentity)?.values() ?? [])];
