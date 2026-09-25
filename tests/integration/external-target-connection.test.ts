// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useTerminalWebSocket from '@/hooks/use-terminal-websocket';

class TestSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: TestSocket[] = [];
  readyState = TestSocket.CONNECTING;
  binaryType = '';
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) { TestSocket.instances.push(this); }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  TestSocket.instances = [];
});

it('shows an external policy rejection without automatic retries and permits manual reconnect', () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('WebSocket', TestSocket);
  const { result } = renderHook(() => useTerminalWebSocket({ externalTarget: { id: 'target', windowId: '@0' } }));
  act(() => result.current.connect('target:@0'));
  expect(TestSocket.instances).toHaveLength(1);
  act(() => TestSocket.instances[0].onclose?.({ code: 1008, reason: 'External target is not registered' }));
  expect(result.current.status).toBe('disconnected');
  expect(result.current.externalTargetFailure).toBe('External target is not registered');
  expect(result.current.retryCount).toBe(0);
  act(() => vi.advanceTimersByTime(60_000));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(TestSocket.instances).toHaveLength(1);

  act(() => result.current.reconnect());
  expect(TestSocket.instances).toHaveLength(2);
  expect(new URL(TestSocket.instances[1].url).searchParams.get('externalTargetId')).toBe('target');
  expect(new URL(TestSocket.instances[1].url).searchParams.get('windowId')).toBe('@0');
  expect(result.current.status).toBe('connecting');
  expect(result.current.externalTargetFailure).toBeNull();
});

it('retains an exact discovered external window target across reconnects', () => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', TestSocket);
  const { result } = renderHook(() => useTerminalWebSocket({
    externalTerminalTarget: { serverId: 'server/id', sessionId: '$4', windowId: '@9' },
  }));
  act(() => result.current.connect('external:$4:@9', 100, 40));

  let url = new URL(TestSocket.instances[0].url);
  expect([...url.searchParams.entries()]).toEqual([
    ['clientId', expect.any(String)],
    ['externalServerId', 'server/id'],
    ['sessionId', '$4'],
    ['windowId', '@9'],
    ['cols', '100'],
    ['rows', '40'],
  ]);

  act(() => TestSocket.instances[0].onclose?.({ code: 1001, reason: 'restart' }));
  act(() => vi.advanceTimersByTime(1000));
  url = new URL(TestSocket.instances[1].url);
  expect(url.searchParams.get('externalServerId')).toBe('server/id');
  expect(url.searchParams.get('sessionId')).toBe('$4');
  expect(url.searchParams.get('windowId')).toBe('@9');
});
