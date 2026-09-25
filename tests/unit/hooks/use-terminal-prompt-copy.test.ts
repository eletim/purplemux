// @vitest-environment jsdom

import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useTerminal from '@/hooks/use-terminal';

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  wheelEvents: [] as Array<{ deltaY: number; precise: boolean }>,
  lines: [] as string[],
  freezeScroll: false,
  viewportY: 0,
  screenOffset: 0,
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
    private screenOffset = 0;
    private readonly writeParsedListeners = new Set<() => void>();
    private readonly scrollListeners = new Set<() => void>();
    buffer = {
      active: {
        length: 5,
        viewportY: 0,
        getLine: (row: number) => {
          const text = mocks.lines[this.screenOffset + row];
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
        const precise = wheelEvent.altKey && wheelEvent.ctrlKey;
        mocks.wheelEvents.push({ deltaY: wheelEvent.deltaY, precise });
        if (!mocks.freezeScroll && wheelEvent.deltaY > 0) {
          const maxOffset = Math.max(0, mocks.lines.length - this.rows);
          this.screenOffset = Math.min(maxOffset, this.screenOffset + (precise ? 1 : 3));
        } else if (!mocks.freezeScroll) {
          this.screenOffset = Math.max(0, this.screenOffset - (precise ? 1 : 3));
        }
        mocks.viewportY = this.buffer.active.viewportY;
        mocks.screenOffset = this.screenOffset;
        this.scrollListeners.forEach((listener) => listener());
        if (!mocks.freezeScroll) {
          this.writeParsedListeners.forEach((listener) => listener());
        }
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
    mocks.wheelEvents.length = 0;
    mocks.lines = [
      'eletim@E-ryzen:~$ run',
      'output one',
      'output two',
      'output three',
      'output four',
      'output five',
      'eletim@E-ryzen:~$ next',
    ];
    mocks.freezeScroll = false;
    mocks.viewportY = 0;
    mocks.screenOffset = 0;
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

  it('scrolls over 100 rows, restores the exact viewport, copies exact text, and shows success', async () => {
    const outputRows = Array.from({ length: 106 }, (_, index) => `output ${index + 1}`);
    mocks.lines = [
      'eletim@E-ryzen:~$ run',
      ...outputRows,
      'eletim@E-ryzen:~$ next',
    ];
    render(createElement(TerminalHarness));

    const marker = await screen.findByRole('button', { name: 'copyPaneLabel' });
    fireEvent.click(marker);

    await waitFor(
      () => expect(mocks.copyToClipboard).toHaveBeenCalledTimes(1),
      { timeout: 25_000 },
    );
    expect(mocks.wheelEvents.filter((event) => event.deltaY > 0)).toHaveLength(103);
    expect(mocks.wheelEvents.filter((event) => event.deltaY < 0)).toHaveLength(103);
    expect(mocks.wheelEvents.every((event) => event.precise)).toBe(true);
    expect(mocks.viewportY).toBe(0);
    expect(mocks.screenOffset).toBe(0);
    expect(mocks.copyToClipboard).toHaveBeenCalledWith([
      'eletim@E-ryzen:~$ run',
      ...outputRows,
    ].join('\n'));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('copyPaneSuccess', {
      id: 'terminal-copy',
      duration: 1500,
    });
  }, 25_000);

  it('does not copy or toast when scrolling never exposes new rows', async () => {
    mocks.freezeScroll = true;
    render(createElement(TerminalHarness));

    const marker = await screen.findByRole('button', { name: 'copyPaneLabel' });
    const gutter = marker.closest<HTMLElement>('.terminal-prompt-marker-gutter');
    fireEvent.click(marker);

    await waitFor(() => expect(gutter?.inert).toBe(false));
    expect(mocks.wheelEvents).toEqual([{ deltaY: 1, precise: true }]);
    expect(mocks.copyToClipboard).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
});
