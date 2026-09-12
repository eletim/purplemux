// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import useTerminal from '@/hooks/use-terminal';

interface IFakeLine {
  text: string;
  isWrapped: boolean;
  length: number;
  translateToString: (trimRight?: boolean, startColumn?: number, endColumn?: number) => string;
}

interface IFakeTerminal {
  buffer: {
    active: {
      length: number;
      cursorY: number;
      cursorX: number;
      getLine: (y: number) => IFakeLine | undefined;
    };
  };
}

const mocks = vi.hoisted(() => ({ terminals: [] as IFakeTerminal[] }));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    element: HTMLElement | null = null;
    options: Record<string, unknown>;
    unicode = { activeVersion: '' };
    buffer = {
      active: {
        type: 'normal' as const,
        baseY: 0,
        viewportY: 0,
        cursorY: 0,
        cursorX: 0,
        length: 0,
        getLine: (_y: number): IFakeLine | undefined => undefined,
      },
    };

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.terminals.push(this);
    }

    loadAddon() {}
    registerLinkProvider() { return { dispose() {} }; }
    open(element: HTMLElement) { this.element = element; }
    onData() { return { dispose() {} }; }
    onTitleChange() { return { dispose() {} }; }
    attachCustomKeyEventHandler() {}
    registerMarker(offset = 0) {
      let disposed = false;
      return {
        id: Math.random(),
        line: this.buffer.active.baseY + this.buffer.active.cursorY + offset,
        get isDisposed() { return disposed; },
        dispose() { disposed = true; },
        onDispose: () => ({ dispose() {} }),
      };
    }
    write() {}
    clear() {}
    reset() {}
    focus() {}
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }));
vi.mock('@xterm/addon-clipboard', () => ({ ClipboardAddon: class {} }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));

const setBuffer = (
  terminal: IFakeTerminal,
  rows: Array<string | [string, boolean]>,
  cursorLine: number,
  cursorColumn: number,
) => {
  const lines = rows.map((row): IFakeLine => {
    const [text, isWrapped] = typeof row === 'string' ? [row, false] : row;
    return {
      text,
      isWrapped,
      length: text.length,
      translateToString: (trimRight = false, start = 0, end) => {
        const value = trimRight ? text.trimEnd() : text;
        return value.slice(start, end);
      },
    };
  });
  terminal.buffer.active.length = lines.length;
  terminal.buffer.active.cursorY = cursorLine;
  terminal.buffer.active.cursorX = cursorColumn;
  terminal.buffer.active.getLine = (y) => lines[y];
};

const setup = async () => {
  const rendered = renderHook(() => useTerminal({ trackCommands: true }));
  act(() => rendered.result.current.terminalRef(document.createElement('div')));
  await waitFor(() => expect(rendered.result.current.isReady).toBe(true));
  return { ...rendered, terminal: mocks.terminals.at(-1)! };
};

describe('useTerminal command tracking', () => {
  beforeAll(() => {
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
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterAll(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps Bash continuation lines in the original path-bearing command', async () => {
    const { result, terminal, unmount } = await setup();
    const prompt = 'user@host:~/repo$ ';
    setBuffer(terminal, [prompt], 0, prompt.length);
    act(() => {
      result.current.trackCommandInput("printf '%s\\n' \\");
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, ["user@host:~/repo$ printf '%s\\n' \\", '> '], 1, 2);
    act(() => {
      result.current.trackCommandInput('hello');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, [
      "user@host:~/repo$ printf '%s\\n' \\",
      '> hello',
      'hello',
      prompt,
    ], 3, prompt.length);

    expect(result.current.getCommandAndOutput()).toBe(
      "user@host:~/repo$ printf '%s\\n' \\\n> hello\nhello",
    );
    unmount();
  });

  it('treats bracketed multiline paste as one submitted command', async () => {
    const { result, terminal, unmount } = await setup();
    const prompt = 'user@host:~/repo$ ';
    setBuffer(terminal, [prompt], 0, prompt.length);
    act(() => {
      result.current.trackCommandInput('\x1b[200~printf first\\nprintf second\x1b[201~');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, [
      'user@host:~/repo$ printf first',
      'printf second',
      'firstsecond',
      prompt,
    ], 3, prompt.length);

    expect(result.current.getCommandAndOutput()).toBe(
      'user@host:~/repo$ printf first\nprintf second\nfirstsecond',
    );
    unmount();
  });

  it('keeps no-newline output before a prompt on the same line', async () => {
    const { result, terminal, unmount } = await setup();
    const prompt = 'user@host:~/repo$ ';
    setBuffer(terminal, [prompt], 0, prompt.length);
    act(() => {
      result.current.trackCommandInput('printf foo');
      result.current.trackCommandInput('\r');
    });
    const finalLine = `foo${prompt}`;
    setBuffer(terminal, ['user@host:~/repo$ printf foo', finalLine], 1, finalLine.length);

    expect(result.current.getCommandAndOutput()).toBe('user@host:~/repo$ printf foo\nfoo');
    unmount();
  });

  it('starts at the path line of a multiline prompt', async () => {
    const { result, terminal, unmount } = await setup();
    setBuffer(terminal, ['user@host:~/repo', '$ '], 1, 2);
    act(() => {
      result.current.trackCommandInput('echo hello');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, [
      'user@host:~/repo',
      '$ echo hello',
      'hello',
      'user@host:~/repo',
      '$ ',
    ], 4, 2);

    expect(result.current.getCommandAndOutput()).toBe(
      'user@host:~/repo\n$ echo hello\nhello',
    );
    unmount();
  });

  it('keeps path output before a plain Bash prompt', async () => {
    const { result, terminal, unmount } = await setup();
    setBuffer(terminal, ['$ '], 0, 2);
    act(() => {
      result.current.trackCommandInput('pwd');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, ['$ pwd', '/home/user/repo', '$ '], 2, 2);

    expect(result.current.getCommandAndOutput()).toBe('$ pwd\n/home/user/repo');
    unmount();
  });

  it('separates commands across wrapped primary prompts', async () => {
    const { result, terminal, unmount } = await setup();
    const prefix = 'user@host:~/very/long/';
    setBuffer(terminal, [prefix, ['repo$ ', true]], 1, 6);
    act(() => {
      result.current.trackCommandInput('echo one');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, [
      prefix,
      ['repo$ echo one', true],
      'one',
      prefix,
      ['repo$ ', true],
    ], 4, 6);
    act(() => {
      result.current.trackCommandInput('echo two');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, [
      prefix,
      ['repo$ echo one', true],
      'one',
      prefix,
      ['repo$ echo two', true],
      'two',
      prefix,
      ['repo$ ', true],
    ], 7, 6);

    expect(result.current.getCommandAndOutput()).toBe(
      'user@host:~/very/long/repo$ echo two\ntwo',
    );
    unmount();
  });
});
