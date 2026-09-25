import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const keyFile = path.join(os.homedir(), '.purplemux', 'external-terminal-marker-key');
const state = globalThis as typeof globalThis & { __purplemuxExternalTerminalMarkerKey?: string };

const readKey = (): string | undefined => {
  try {
    const value = fs.readFileSync(keyFile, 'utf8').trim();
    return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

export const getExternalTerminalMarkerKey = (): string => {
  if (state.__purplemuxExternalTerminalMarkerKey) return state.__purplemuxExternalTerminalMarkerKey;
  const existing = readKey();
  if (existing) {
    state.__purplemuxExternalTerminalMarkerKey = existing;
    return existing;
  }
  const generated = randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  try {
    fs.writeFileSync(keyFile, generated, { mode: 0o600, flag: 'wx' });
    state.__purplemuxExternalTerminalMarkerKey = generated;
  } catch (error) {
    const raced = readKey();
    if (!raced) throw error;
    state.__purplemuxExternalTerminalMarkerKey = raced;
  }
  return state.__purplemuxExternalTerminalMarkerKey;
};
