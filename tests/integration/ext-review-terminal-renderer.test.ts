// @vitest-environment jsdom
import { createElement } from 'react';
import type { Terminal } from '@xterm/xterm';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const renderer = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  resize: vi.fn(), fit: vi.fn(),
  data: null as null | ((data: string) => void),
  key: null as null | ((event: KeyboardEvent) => boolean),
  instance: null as Terminal | null,
}));
vi.mock('@xterm/xterm', async (importOriginal) => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const actual = await importOriginal<typeof import('@xterm/xterm')>();
  return { Terminal: class extends actual.Terminal {
    constructor(options: ConstructorParameters<typeof actual.Terminal>[0]) {
      super(options);
      renderer.options = options as Record<string, unknown>;
      renderer.instance = this;
      const onData = this.onData;
      Object.defineProperty(this, 'onData', {
        value: (handler: (data: string) => void) => {
          renderer.data = handler;
          return onData(handler);
        },
      });
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      renderer.key = handler;
      super.attachCustomKeyEventHandler(handler);
    }
    // Rendering requires canvas; leave open stubbed while retaining xterm's real parser and buffer.
    open() {}
    resize(cols: number, rows: number) {
      renderer.resize(cols, rows);
      super.resize(cols, rows);
    }
  } };
});
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {
  activate() {}
  dispose() {}
  fit = renderer.fit;
} }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
import useTerminal from '@/hooks/use-terminal';

beforeEach(() => {
  vi.clearAllMocks();
  renderer.instance = null;
  renderer.key = null;
  vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this); } });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {} } });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('disables xterm input and auto-fit while applying external dimensions only to the local renderer', async () => {
  const onInput = vi.fn();
  const onResize = vi.fn();
  function Viewer() {
    const { terminalRef } = useTerminal({ readOnly: true, onInput, onResize });
    return createElement('div', { ref: terminalRef });
  }
  render(createElement(Viewer));
  await waitFor(() => expect(renderer.key).not.toBeNull());
  expect(renderer.options.disableStdin).toBe(true);
  renderer.data?.('typed or pasted text');
  expect(renderer.key?.(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }))).toBe(false);
  const terminal = renderer.instance!;
  expect([terminal.cols, terminal.rows]).toEqual([80, 24]);
  // Exercise the actual parser, including its windowOptions gate, and the far screen corner.
  await new Promise<void>((resolve) => terminal.write('\x1b[8;30;90t\x1b[30;90HX', resolve));
  expect([terminal.cols, terminal.rows]).toEqual([90, 30]);
  expect(renderer.resize).toHaveBeenCalledWith(90, 30);
  expect(terminal.buffer.active.getLine(29)?.getCell(89)?.getChars()).toBe('X');
  await new Promise<void>((resolve) => terminal.write('\x1b[8;0;160t', resolve));
  expect([terminal.cols, terminal.rows]).toEqual([90, 30]);
  expect(renderer.fit).not.toHaveBeenCalled();
  expect(onInput).not.toHaveBeenCalled();
  expect(onResize).not.toHaveBeenCalled();
});

it('keeps ANSI window sizing disabled for managed interactive rendering', async () => {
  function Viewer() {
    const { terminalRef } = useTerminal();
    return createElement('div', { ref: terminalRef });
  }
  render(createElement(Viewer));
  await waitFor(() => expect(renderer.key).not.toBeNull());
  const terminal = renderer.instance!;
  expect(terminal.options.windowOptions?.setWinSizeChars).toBe(false);
  await new Promise<void>((resolve) => terminal.write('\x1b[8;30;90t', resolve));
  expect([terminal.cols, terminal.rows]).toEqual([80, 24]);
  expect(renderer.resize).not.toHaveBeenCalled();
});
