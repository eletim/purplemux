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
