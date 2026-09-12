// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import useTerminal from '@/hooks/use-terminal';

interface IFakeLine {
  text: string;
  isWrapped: boolean;
  length: number;
  getCell: (x: number) => { getChars: () => string; getWidth: () => number } | undefined;
  translateToString: (trimRight?: boolean, startColumn?: number, endColumn?: number) => string;
}

interface IFakeTerminal {
  element: HTMLElement | null;
  emitTitle: (title: string) => void;
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
    titleChangeHandler: ((title: string) => void) | null = null;
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
    onTitleChange(callback: (title: string) => void) {
      this.titleChangeHandler = callback;
      return { dispose() {} };
    }
    emitTitle(title: string) { this.titleChangeHandler?.(title); }
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
      getCell: (x) => x < text.length
        ? { getChars: () => text[x], getWidth: () => 1 }
        : undefined,
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

const setup = async (cwd?: string) => {
  const rendered = renderHook(
    ({ currentCwd }) => useTerminal({ trackCommands: true, cwd: currentCwd }),
    { initialProps: { currentCwd: cwd } },
  );
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
    const { result, terminal, unmount } = await setup('/home/user/repo');
    setBuffer(terminal, ['$ '], 0, 2);
    act(() => {
      result.current.trackCommandInput('pwd');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, ['$ pwd', '/home/user/repo', '$ '], 2, 2);

    expect(result.current.getCommandAndOutput()).toBe('/home/user/repo\n$ pwd\n/home/user/repo');
    unmount();
  });

  it('starts a new command after Ctrl+C cancels unsubmitted input', async () => {
    const { result, terminal, unmount } = await setup();
    setBuffer(terminal, ['$ '], 0, 2);
    act(() => {
      result.current.trackCommandInput('echo canceled');
      result.current.trackCommandInput('\x03');
    });
    setBuffer(terminal, ['$ echo canceled', '^C', '$ '], 2, 2);
    act(() => {
      result.current.trackCommandInput('echo next');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, ['$ echo canceled', '^C', '$ echo next', 'next', '$ '], 4, 2);

    expect(result.current.getCommandAndOutput()).toBe('$ echo next\nnext');
    unmount();
  });

  it('isolates a command submitted while the preceding command is still running', async () => {
    const { result, terminal, unmount } = await setup('/home/user/repo');
    setBuffer(terminal, ['$ '], 0, 2);
    act(() => {
      result.current.trackCommandInput('cd /tmp');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, ['$ cd /tmp'], 0, 9);
    act(() => {
      result.current.trackCommandInput('pwd');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, ['$ cd /tmp', '$ pwd', '/tmp', '$ '], 3, 2);
    terminal.element!.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 240,
      width: 800, height: 240, toJSON: () => ({}),
    });

    act(() => result.current.setCommandCopyTarget(10, 5));
    expect(result.current.getCommandAndOutput()).toBe('/home/user/repo\n$ cd /tmp');

    act(() => result.current.setCommandCopyTarget(10, 25));
    expect(result.current.getCommandAndOutput()).toBe('');
    unmount();
  });

  it('snapshots the title-derived execution CWD for a live pathless Bash prompt', async () => {
    const { result, terminal, unmount } = await setup();
    act(() => terminal.emitTitle('bash|/home/user/one'));
    setBuffer(terminal, ['$ '], 0, 2);
    act(() => {
      result.current.trackCommandInput('echo hello');
      result.current.trackCommandInput('\r');
    });
    act(() => terminal.emitTitle('bash|/home/user/two'));
    setBuffer(terminal, ['$ echo hello', 'hello', '$ '], 2, 2);

    expect(result.current.getCommandAndOutput()).toBe('/home/user/one\n$ echo hello\nhello');
    unmount();
  });

  it('does not assign the current CWD to a historical pathless Bash command', async () => {
    const { result, terminal, unmount } = await setup('/home/user/current');
    setBuffer(terminal, ['$ pwd', '/home/user/historical', '$ '], 2, 2);
    terminal.element!.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 240,
      width: 800, height: 240, toJSON: () => ({}),
    });
    act(() => result.current.setCommandCopyTarget(10, 15));

    expect(result.current.getCommandAndOutput()).toBe('');
    unmount();
  });

  it('copies a restored command whose prompt contains its execution path', async () => {
    const { result, terminal, unmount } = await setup('/home/user/current');
    setBuffer(terminal, [
      'user@host:~/historical$ echo hello',
      'hello',
      'user@host:~/current$ ',
    ], 2, 21);
    terminal.element!.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 240,
      width: 800, height: 240, toJSON: () => ({}),
    });
    act(() => result.current.setCommandCopyTarget(10, 15));

    expect(result.current.getCommandAndOutput()).toBe(
      'user@host:~/historical$ echo hello\nhello',
    );
    unmount();
  });

  it('adds captured CWD context to a decorated pathless prompt', async () => {
    const { result, terminal, unmount } = await setup('/home/user/repo');
    const prompt = '(env/foo) $ ';
    setBuffer(terminal, [prompt], 0, prompt.length);
    act(() => {
      result.current.trackCommandInput('echo hello');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, [`${prompt}echo hello`, 'hello', prompt], 2, prompt.length);

    expect(result.current.getCommandAndOutput()).toBe(
      '/home/user/repo\n(env/foo) $ echo hello\nhello',
    );
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

  it('tracks path-only multiline prompt structure without confusing pwd output', async () => {
    const { result, terminal, unmount } = await setup();
    setBuffer(terminal, ['~/repo', '$ '], 1, 2);
    act(() => {
      result.current.trackCommandInput('pwd');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, [
      '~/repo',
      '$ pwd',
      '/home/user/repo',
      '~/repo',
      '$ ',
    ], 4, 2);

    expect(result.current.getCommandAndOutput()).toBe(
      '~/repo\n$ pwd\n/home/user/repo',
    );
    unmount();
  });

  it('tracks the complete virtualenv-decorated prompt', async () => {
    const { result, terminal, unmount } = await setup();
    const prompt = '(venv) user@host:~/repo$ ';
    setBuffer(terminal, [prompt], 0, prompt.length);
    act(() => {
      result.current.trackCommandInput('echo ok');
      result.current.trackCommandInput('\r');
    });
    setBuffer(terminal, [`${prompt}echo ok`, 'ok', prompt], 2, prompt.length);

    expect(result.current.getCommandAndOutput()).toBe(`${prompt}echo ok\nok`);
    unmount();
  });
});
