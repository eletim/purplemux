// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useTerminal from '@/hooks/use-terminal';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  wheelDeltas: [] as number[],
  downViewport: 2,
}));

vi.mock('@/lib/clipboard', () => ({ copyToClipboard: mocks.copyToClipboard }));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess } }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/addon-clipboard', () => ({ ClipboardAddon: class {} }));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    rows = 5;
    cols = 80;
    options: Record<string, unknown> = {};
    element: HTMLElement | undefined;
    unicode = { activeVersion: '' };
    parser = { registerCsiHandler: vi.fn() };
    private readonly lines = [
      'eletim@E-ryzen:~$ run',
      'output one',
      'output two',
      'output three',
      'output four',
      'output five',
      'eletim@E-ryzen:~$ next',
    ];
    private readonly writeParsedListeners = new Set<() => void>();
    private readonly scrollListeners = new Set<() => void>();
    buffer = {
      active: {
        length: 7,
        viewportY: 0,
        getLine: (row: number) => {
          const text = this.lines[row];
          return text === undefined ? undefined : {
            isWrapped: false,
            translateToString: (trimRight = false) => trimRight ? text.trimEnd() : text,
          };
        },
      },
    };

    loadAddon() {}
    registerLinkProvider() {}
    attachCustomKeyEventHandler() {}
    onData() { return { dispose() {} }; }
    onTitleChange() { return { dispose() {} }; }
    onResize(listener: () => void) { return this.subscribe(this.scrollListeners, listener); }
    onScroll(listener: () => void) { return this.subscribe(this.scrollListeners, listener); }
    onWriteParsed(listener: () => void) { return this.subscribe(this.writeParsedListeners, listener); }
    clear() {}
    reset() {}
    focus() {}
    write() {}
    dispose() {}
    resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; }

    open(container: HTMLElement) {
      this.element = document.createElement('div');
      const screenElement = document.createElement('div');
      screenElement.className = 'xterm-screen';
      screenElement.getBoundingClientRect = () => ({
        x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 100,
        width: 800, height: 100, toJSON: () => ({}),
      });
      screenElement.addEventListener('wheel', (event) => {
        const wheelEvent = event as WheelEvent;
        mocks.wheelDeltas.push(wheelEvent.deltaY);
        this.buffer.active.viewportY = wheelEvent.deltaY > 0 ? mocks.downViewport : 0;
        this.scrollListeners.forEach((listener) => listener());
        this.writeParsedListeners.forEach((listener) => listener());
      });
      this.element.appendChild(screenElement);
      container.appendChild(this.element);
    }

    private subscribe(listeners: Set<() => void>, listener: () => void) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    }
  },
}));

const TerminalHarness = () => {
  const { terminalRef } = useTerminal({
    enablePromptMarkers: true,
    promptPrefix: 'eletim@E-ryzen:',
  });
  return createElement('div', { ref: terminalRef });
};

describe('useTerminal prompt copying', () => {
  beforeEach(() => {
    mocks.copyToClipboard.mockReset().mockResolvedValue(true);
    mocks.toastSuccess.mockReset();
    mocks.wheelDeltas.length = 0;
    mocks.downViewport = 2;
    vi.stubGlobal('FontFace', class {
      load() { return Promise.resolve(this); }
    });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn() },
    });
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(performance.now()), 0)
    ));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('scrolls by wheel, copies the exact prompt block, restores, and shows success', async () => {
    render(createElement(TerminalHarness));

    const marker = await screen.findByRole('button', { name: 'copyPaneLabel' });
    fireEvent.click(marker);

    await waitFor(() => expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1));
    expect(mocks.wheelDeltas).toEqual([1, -1]);
    expect(mocks.copyToClipboard).toHaveBeenCalledWith([
      'eletim@E-ryzen:~$ run',
      'output one',
      'output two',
      'output three',
      'output four',
      'output five',
    ].join('\n'));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('copyPaneSuccess', {
      id: 'terminal-copy',
      duration: 1500,
    });
  });

  it('does not copy or toast when scrolling never exposes new rows', async () => {
    mocks.downViewport = 0;
    render(createElement(TerminalHarness));

    const marker = await screen.findByRole('button', { name: 'copyPaneLabel' });
    const gutter = marker.closest<HTMLElement>('.terminal-prompt-marker-gutter');
    fireEvent.click(marker);

    await waitFor(() => expect(gutter?.inert).toBe(false));
    expect(mocks.wheelDeltas).toEqual([1]);
    expect(mocks.copyToClipboard).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
