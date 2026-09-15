// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const renderer = vi.hoisted(() => ({
  options: {} as Record<string, unknown>,
  resize: vi.fn(), fit: vi.fn(),
  data: null as null | ((data: string) => void),
  key: null as null | ((event: KeyboardEvent) => boolean),
  geometry: null as null | ((params: number[]) => boolean),
}));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  options: Record<string, unknown>;
  unicode = { activeVersion: '' };
  parser = { registerCsiHandler: (_id: unknown, handler: (params: number[]) => boolean) => { renderer.geometry = handler; } };
  cols = 80;
  rows = 24;
  constructor(options: Record<string, unknown>) { renderer.options = options; this.options = options; }
  loadAddon() {}
  registerLinkProvider() {}
  open() {}
  onData(handler: (data: string) => void) { renderer.data = handler; }
  onTitleChange() {}
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { renderer.key = handler; }
  resize = renderer.resize;
  dispose() {}
} }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = renderer.fit; } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
import useTerminal from '@/hooks/use-terminal';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('disables xterm input and auto-fit while applying external dimensions only to the local renderer', async () => {
  vi.stubGlobal('FontFace', class { load() { return Promise.resolve(this); } });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add() {} } });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const onInput = vi.fn();
  const onResize = vi.fn();
  function Viewer() {
    const { terminalRef } = useTerminal({ readOnly: true, onInput, onResize });
    return createElement('div', { ref: terminalRef });
  }
  render(createElement(Viewer));
  await waitFor(() => expect(renderer.geometry).not.toBeNull());
  expect(renderer.options.disableStdin).toBe(true);
  renderer.data?.('typed or pasted text');
  expect(renderer.key?.(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }))).toBe(false);
  expect(renderer.geometry?.([8, 50, 160])).toBe(true);
  expect(renderer.resize).toHaveBeenCalledWith(160, 50);
  expect(renderer.geometry?.([8, 0, 160])).toBe(false);
  expect(renderer.fit).not.toHaveBeenCalled();
  expect(onInput).not.toHaveBeenCalled();
  expect(onResize).not.toHaveBeenCalled();
});
