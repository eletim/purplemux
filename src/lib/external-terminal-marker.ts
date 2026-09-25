import { createHmac, timingSafeEqual } from 'crypto';
import { getExternalTerminalMarkerKey } from '@/lib/external-terminal-marker-key';
import type { IExternalServer, IExternalTerminalProvenance } from '@/types/external-server';

type MarkerIdentity = Pick<IExternalTerminalProvenance, 'id' | 'createdAt'> & { requestId: string };

const sign = (socketIdentity: string, kind: 'pending' | 'owned', payload: string): string =>
  createHmac('sha256', getExternalTerminalMarkerKey())
    .update(`purplemux.external-terminal.v2\0${socketIdentity}\0${kind}\0${payload}`)
    .digest('base64url');

const encode = (kind: 'pending' | 'owned', socketIdentity: string, values: unknown[]): string => {
  const payload = Buffer.from(JSON.stringify(values)).toString('base64url');
  return `v2${kind === 'pending' ? 'p' : ''}.${payload}.${sign(socketIdentity, kind, payload)}`;
};

const decode = (kind: 'pending' | 'owned', socketIdentity: string, marker: string): unknown[] | undefined => {
  const prefix = kind === 'pending' ? 'v2p' : 'v2';
  const match = new RegExp(`^${prefix}\\.([A-Za-z0-9_-]{1,768})\\.([A-Za-z0-9_-]{43})$`).exec(marker);
  if (!match) return undefined;
  const actual = Buffer.from(match[2]);
  const expected = Buffer.from(sign(socketIdentity, kind, match[1]));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
    return Array.isArray(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const validIdentity = (values: unknown[]): values is [string, string, number] =>
  values.length === 3 && typeof values[0] === 'string' && /^[-_A-Za-z0-9]{21}$/.test(values[0])
  && typeof values[1] === 'string' && /^[-_A-Za-z0-9]{1,128}$/.test(values[1])
  && typeof values[2] === 'number' && Number.isSafeInteger(values[2]) && values[2] >= 0;

export const encodePendingExternalTerminalMarker = (
  server: Pick<IExternalServer, 'socketIdentity'>,
  identity: MarkerIdentity,
): string => encode('pending', server.socketIdentity,
  [identity.id, identity.requestId, new Date(identity.createdAt).getTime()]);

export const decodePendingExternalTerminalMarker = (
  server: Pick<IExternalServer, 'socketIdentity'>,
  marker: string,
): MarkerIdentity | undefined => {
  const values = decode('pending', server.socketIdentity, marker);
  if (!values || !validIdentity(values)) return undefined;
  const createdAt = new Date(values[2]);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return { id: values[0], requestId: values[1], createdAt: createdAt.toISOString() };
};

export const encodeOwnedExternalTerminalMarker = (
  server: Pick<IExternalServer, 'socketIdentity'>,
  provenance: IExternalTerminalProvenance,
): string => encode('owned', server.socketIdentity, [
  provenance.id, provenance.requestId, new Date(provenance.createdAt).getTime(),
  provenance.sessionId, provenance.sessionCreated,
]);

export const decodeOwnedExternalTerminalMarker = (
  server: Pick<IExternalServer, 'socketIdentity'>,
  sessionId: string,
  sessionCreated: string,
  marker: string,
): IExternalTerminalProvenance | undefined => {
  const values = decode('owned', server.socketIdentity, marker);
  if (!values || values.length !== 5) return undefined;
  const identity = values.slice(0, 3);
  if (!validIdentity(identity)
    || values[3] !== sessionId || values[4] !== sessionCreated) return undefined;
  const createdAt = new Date(identity[2]);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return {
    id: identity[0],
    requestId: identity[1],
    owner: 'purplemux',
    resourceType: 'session',
    sessionId,
    sessionCreated,
    createdAt: createdAt.toISOString(),
  };
};
