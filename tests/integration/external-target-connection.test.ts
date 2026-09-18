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
  vi.unstubAllGlobals();
  TestSocket.instances = [];
});

it('shows an external policy rejection and does not reconnect', () => {
  vi.useFakeTimers();
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
});
