// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExternalTerminalSurface from '@/components/features/workspace/external-terminal-surface';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  reconnect: vi.fn(),
  sendStdin: vi.fn(),
  sendWebStdin: vi.fn(),
  sendResize: vi.fn(),
  write: vi.fn(),
  fit: vi.fn(() => ({ cols: 100, rows: 30 })),
  focus: vi.fn(),
  terminalOptions: vi.fn(),
  websocketOptions: vi.fn(),
}));

vi.mock('@/hooks/use-config-store', () => ({
  default: (selector: (state: Record<string, unknown>) => unknown) => selector({
    fontSize: 'large',
    lineHeight: 'custom',
    lineHeightCustom: 1.25,
    terminalKeyBar: 'auto',
    promptPrefix: '$ ',
  }),
}));
vi.mock('@/hooks/use-is-mobile-device', () => ({ default: () => true }));
vi.mock('@/hooks/use-terminal-theme', () => ({ default: () => ({ theme: { colors: { background: '#101010' } } }) }));
vi.mock('@/hooks/use-terminal', () => ({ default: (options: unknown) => {
  mocks.terminalOptions(options);
  return {
    terminalRef: () => {},
    write: mocks.write,
    fit: mocks.fit,
    focus: mocks.focus,
    isReady: true,
  };
} }));
vi.mock('@/hooks/use-terminal-websocket', () => ({ default: (options: unknown) => {
  mocks.websocketOptions(options);
  return {
    status: 'connected',
    retryCount: 0,
    disconnectReason: null,
    externalTargetFailure: null,
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    reconnect: mocks.reconnect,
    sendStdin: mocks.sendStdin,
    sendWebStdin: mocks.sendWebStdin,
    sendResize: mocks.sendResize,
  };
} }));
vi.mock('@/components/features/workspace/terminal-container', () => ({
  default: () => createElement('div', { 'data-testid': 'terminal-container' }),
}));
vi.mock('@/components/features/workspace/connection-status', () => ({
  default: ({ onReconnect }: { onReconnect: () => void }) => createElement('button', { onClick: onReconnect }, 'Reconnect'),
}));
vi.mock('@/components/features/mobile/mobile-terminal-toolbar', () => ({
  default: ({ sendStdin }: { sendStdin: (data: string) => void }) =>
    createElement('button', { onClick: () => sendStdin('pasted input\r') }, 'Send web input'),
}));
vi.mock('@/components/features/workspace/terminal-key-bar', () => ({ default: () => null }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('external terminal surface', () => {
  it('uses the standard terminal interactions for a discovered external window', () => {
    const target = { serverId: 'server-1', sessionId: '$1', windowId: '@2' };
    render(createElement(ExternalTerminalSurface, { externalTerminalTarget: target }));

    expect(screen.getByTestId('terminal-container')).toBeTruthy();
    expect(mocks.websocketOptions).toHaveBeenCalledWith(expect.objectContaining({ externalTerminalTarget: target }));
    expect(mocks.terminalOptions).toHaveBeenCalledWith(expect.objectContaining({
      enablePromptCopy: true,
      promptPrefix: '$ ',
      fontSize: 14,
      lineHeight: 1.25,
      onResize: mocks.sendResize,
    }));
    expect(mocks.connect).toHaveBeenCalledWith('server-1:$1:@2', 100, 30);
    expect(mocks.focus).toHaveBeenCalledOnce();

    const terminalOptions = mocks.terminalOptions.mock.calls[0][0] as { onInput: (data: string) => void };
    act(() => terminalOptions.onInput('ls\r'));
    expect(mocks.sendStdin).toHaveBeenCalledWith('ls\r');

    fireEvent.click(screen.getByRole('button', { name: 'Send web input' }));
    expect(mocks.sendWebStdin).toHaveBeenCalledWith('pasted input\r');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(mocks.reconnect).toHaveBeenCalledOnce();
  });
});
