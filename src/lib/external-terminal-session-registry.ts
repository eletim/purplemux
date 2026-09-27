export const EXTERNAL_TERMINAL_SESSION_OPTION = '@purplemux_internal_external_client';

export interface IExternalTerminalSessionRegistration {
  socketIdentity: string;
  sessionName: string;
  marker: string;
  sessionId?: string;
}

const globalStore = globalThis as unknown as {
  __purplemux_external_terminal_sessions?: Map<string, Map<string,
    IExternalTerminalSessionRegistration>>;
};
const registeredSessions = globalStore.__purplemux_external_terminal_sessions ??= new Map();

const registrationsFor = (socketIdentity: string): Map<string,
  IExternalTerminalSessionRegistration> | undefined => registeredSessions.get(socketIdentity);

export const registerExternalTerminalSession = (
  registration: IExternalTerminalSessionRegistration,
): IExternalTerminalSessionRegistration => {
  let sessions = registeredSessions.get(registration.socketIdentity);
  if (!sessions) {
    sessions = new Map();
    registeredSessions.set(registration.socketIdentity, sessions);
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
  if (registrationsFor(registration.socketIdentity)?.get(registration.sessionName) !== registration) {
    throw new Error('External terminal client session is not registered');
  }
  registration.sessionId = sessionId;
};

export const unregisterExternalTerminalSession = (
  registration: IExternalTerminalSessionRegistration,
): void => {
  const sessions = registeredSessions.get(registration.socketIdentity);
  if (sessions?.get(registration.sessionName) !== registration) return;
  sessions.delete(registration.sessionName);
  if (sessions.size === 0) registeredSessions.delete(registration.socketIdentity);
};

export const registeredExternalTerminalSessions = (
  socketIdentity: string,
): ReadonlyArray<Readonly<IExternalTerminalSessionRegistration>> =>
  [...(registrationsFor(socketIdentity)?.values() ?? [])];
