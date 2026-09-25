// Shared by the terminal WebSocket server and the registration API bundle.
const state = globalThis as typeof globalThis & {
  __purplemuxExternalTerminals?: Map<object, { targetId: string; stop: () => void }>;
};

export const externalTerminals = state.__purplemuxExternalTerminals ??= new Map();

export const stopExternalTerminals = (targetId: string): void => {
  for (const connection of externalTerminals.values()) {
    if (connection.targetId === targetId) connection.stop();
  }
};
