import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const password = 'browser-terminal-test';

interface ITmuxPane {
  selector: string[];
  target: string;
}

const findChrome = async (): Promise<string> => {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((candidate): candidate is string => !!candidate);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* try the next installation */ }
  }
  throw new Error('Chrome/Chromium not found; set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH');
};

const freePort = async (): Promise<number> => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    assert(address && typeof address !== 'string');
    server.close((error) => error ? reject(error) : resolve(address.port));
  });
});

const waitForServer = async (origin: string, child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`purplemux exited with ${child.exitCode}`);
    try {
      await new Promise<void>((resolve, reject) => {
        const request = http.get(`${origin}/api/auth/setup`, (response) => {
          response.resume();
          response.once('end', resolve);
        });
        request.once('error', reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error('Timed out waiting for purplemux');
};

const tmux = async (pane: ITmuxPane, ...args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('tmux', [...pane.selector, ...args]);
  return stdout;
};

const capture = (pane: ITmuxPane): Promise<string> =>
  tmux(pane, 'capture-pane', '-p', '-J', '-S', '-200', '-t', pane.target);

const waitForClient = async (pane: ITmuxPane): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const clients = (await tmux(pane, 'list-clients', '-F', '#{client_pid}:#{client_flags}'))
        .trim().split('\n');
      if (clients.some((value) => value && !value.includes('no-output'))) return;
    } catch { /* the first terminal client is still attaching */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for the tmux client for ${pane.target}`);
};

const waitForCapture = async (pane: ITmuxPane, text: string, timeout = 10_000): Promise<string> => {
  const deadline = Date.now() + timeout;
  let contents = '';
  while (Date.now() < deadline) {
    contents = await capture(pane);
    if (contents.includes(text)) return contents;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for terminal output: ${text}\n${contents}`);
};

const waitForTmuxValue = async (pane: ITmuxPane, format: string, expected: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = (await tmux(
      pane, 'display-message', '-p', '-t', pane.target, format,
    )).trim();
    if (value === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for tmux ${format}=${expected}`);
};

const waitForCaptureCount = async (pane: ITmuxPane, text: string, count: number): Promise<string> => {
  const deadline = Date.now() + 10_000;
  let contents = '';
  while (Date.now() < deadline) {
    contents = await capture(pane);
    if (contents.split(text).length - 1 >= count) return contents;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${count} terminal occurrences: ${text}\n${contents}`);
};

const terminalScreen = (page: Page) => page.locator('.xterm-screen');

const login = async (context: BrowserContext, origin: string): Promise<void> => {
  const response = await context.request.post(`${origin}/api/auth/login`, { data: { password } });
  assert.equal(response.status(), 200, await response.text());
};

const openTerminal = async (context: BrowserContext, origin: string): Promise<Page> => {
  await login(context, origin);
  const page = await context.newPage();
  await page.goto(`${origin}/external-server`);
  await terminalScreen(page).waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('.xterm-helper-textarea').focus();
  return page;
};

const typeCommand = async (page: Page, command: string): Promise<void> => {
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.insertText(command);
  await page.keyboard.press('Enter');
};

const copySentinelWithDrag = async (page: Page, pane: ITmuxPane): Promise<string> => {
  const sentinel = 'COPY_BROWSER_SENTINEL';
  await typeCommand(page,
    `for i in $(seq 1 80); do echo COPY_BROWSER_FILL; done; for i in 1 2 3 4 5; do echo ${sentinel}; done`);
  await waitForCaptureCount(pane, sentinel, 5);
  await page.evaluate(() => navigator.clipboard.writeText(''));

  const box = await terminalScreen(page).boundingBox();
  assert(box, 'terminal screen has no browser geometry');
  const rows = Number((await tmux(
    pane, 'display-message', '-p', '-t', pane.target, '#{pane_height}',
  )).trim());
  const character = await page.locator('.xterm-char-measure-element').first().boundingBox();
  assert(character, 'xterm character geometry is unavailable');
  const cellWidth = character.width / 32;
  const renderedRows = Math.floor(box.height / character.height);
  const visibleRows = Math.min(rows, renderedRows);
  const selectionStartY = box.y + ((visibleRows - 7.5) * character.height);
  const selectionEndY = box.y + ((visibleRows - 1.5) * character.height);
  await page.mouse.move(box.x + (0.5 * cellWidth), selectionStartY);
  await page.mouse.down();
  await page.mouse.move(box.x + (22.5 * cellWidth), selectionEndY, { steps: 10 });
  await page.mouse.up();

  let copied = '';
  const clipboardDeadline = Date.now() + 10_000;
  while (Date.now() < clipboardDeadline) {
    copied = await page.evaluate(async () => navigator.clipboard.readText());
    if (copied.includes(sentinel)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const copiedSentinels = copied.split(/\r?\n/).filter((line) => line === sentinel);
  assert(copiedSentinels.length > 0,
    `tmux drag selection must reach the browser clipboard, received ${JSON.stringify(copied)}`);
  return copiedSentinels[0];
};

const main = async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-browser-terminal-'));
  const socket = path.join(temporary, 'external.sock');
  const externalPane: ITmuxPane = {
    selector: ['-S', socket],
    target: 'browser-terminal:0.0',
  };
  const probe = path.join(temporary, 'input-probe.py');
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  let server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let managedSession: string | undefined;
  let serverLog = '';

  try {
    await fs.writeFile(probe, String.raw`import os, select, sys, termios, tty
mode = sys.argv[1]
fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
tty.setraw(fd)
mouse = mode.startswith("mouse-")
label = mode.upper().replace("-", "_")
if mouse:
    os.write(sys.stdout.fileno(), b"\x1b[?1000h\x1b[?1006h" + label.encode() + b"_READY\r\n")
else:
    os.write(sys.stdout.fileno(), (label + "_READY\r\n").encode())
data = b""
deadline = 2.0
while True:
    readable, _, _ = select.select([fd], [], [], deadline)
    if not readable:
        break
    data += os.read(fd, 64)
    if not mouse or data.endswith((b"M", b"m")):
        break
if mouse:
    os.write(sys.stdout.fileno(), b"\x1b[?1000l\x1b[?1006l")
termios.tcsetattr(fd, termios.TCSADRAIN, old)
print("PROBE_" + label + ":" + data.hex(), flush=True)
`);

    await execFileAsync('tmux', [
      '-f', path.join(root, 'src/config/tmux.conf'), '-S', socket,
      'new-session', '-d', '-x', '100', '-y', '30', '-s', 'browser-terminal',
      'exec bash --noprofile --norc',
    ]);

    server = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'server.ts'], {
      cwd: root,
      env: {
        ...process.env,
        HOME: temporary,
        INIT_PASSWORD: password,
        PORT: String(port),
        HOST: '127.0.0.1',
        __PMUX_APP_DIR: root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (chunk) => { serverLog += chunk; });
    server.stderr?.on('data', (chunk) => { serverLog += chunk; });
    await waitForServer(origin, server);

    const executablePath = await findChrome();
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await login(context, origin);
    const setup = await context.request.post(`${origin}/api/auth/setup`, {
      data: { authPassword: password, locale: 'en', appTheme: 'dark', networkAccess: 'localhost' },
    });
    assert.equal(setup.status(), 200, await setup.text());
    await login(context, origin);
    const registration = await context.request.post(`${origin}/api/cli/external-servers`, {
      data: { name: 'Browser semantics', socketPath: socket },
    });
    assert.equal(registration.status(), 201, await registration.text());

    const page = await context.newPage();
    let terminalOutputReady!: () => void;
    const firstTerminalOutput = new Promise<void>((resolve) => { terminalOutputReady = resolve; });
    page.on('websocket', (websocket) => {
      if (websocket.url().includes('/api/terminal')) {
        websocket.on('framereceived', ({ payload }) => {
          if (typeof payload !== 'string' && payload[0] === 0x01) terminalOutputReady();
        });
      }
    });
    await page.goto(`${origin}/external-server`);
    await terminalScreen(page).waitFor({ state: 'visible', timeout: 30_000 });
    await waitForClient(externalPane);
    await Promise.race([
      firstTerminalOutput,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Terminal output did not connect')), 10_000)),
    ]);
    if ((await tmux(externalPane, 'display-message', '-p', '-t', externalPane.target, '#{pane_in_mode}')).trim() === '1') {
      await tmux(externalPane, 'send-keys', '-t', externalPane.target, '-X', 'cancel');
    }

    await tmux(externalPane, 'send-keys', '-t', externalPane.target, `python3 ${probe} keyboard`, 'Enter');
    await waitForCapture(externalPane, 'KEYBOARD_READY');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('k');
    assert.match(await waitForCapture(externalPane, 'PROBE_KEYBOARD:'), /PROBE_KEYBOARD:6b/,
      'a real browser key event must reach the external PTY');
    await typeCommand(page, "printf 'KEYBOARD_OK\\n'");
    await waitForCaptureCount(externalPane, 'KEYBOARD_OK', 2);

    await typeCommand(page, `python3 ${probe} plain`);
    await waitForCapture(externalPane, 'PLAIN_READY');
    const box = await terminalScreen(page).boundingBox();
    assert(box, 'terminal screen has no browser geometry');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('q');
    assert.match(await waitForCapture(externalPane, 'PROBE_PLAIN:'), /PROBE_PLAIN:71/,
      'a browser click must not become PTY text when mouse reporting is disabled');

    await typeCommand(page, "for i in $(seq 1 80); do printf 'SCROLL_%03d\\n' \"$i\"; done");
    await waitForCapture(externalPane, 'SCROLL_080');
    await typeCommand(page, `python3 ${probe} wheel`);
    await waitForCapture(externalPane, 'WHEEL_READY');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await waitForTmuxValue(externalPane, '#{pane_in_mode}', '1');
    await page.keyboard.press('q');
    await waitForTmuxValue(externalPane, '#{pane_in_mode}', '0');
    await page.keyboard.press('q');
    assert.match(await waitForCapture(externalPane, 'PROBE_WHEEL:'), /PROBE_WHEEL:71/,
      'wheel input handled by tmux scrollback must not also become PTY text');

    await typeCommand(page, `python3 ${probe} mouse-click`);
    await waitForCapture(externalPane, 'MOUSE_CLICK_READY');
    await page.mouse.click(box.x + box.width / 3, box.y + box.height / 3);
    assert.match(await waitForCapture(externalPane, 'PROBE_MOUSE_CLICK:'),
      /PROBE_MOUSE_CLICK:1b5b3c(?:30|31)[0-9a-f]*4d/,
      'tmux must forward SGR click reports to a TUI');

    await typeCommand(page, `python3 ${probe} mouse-wheel`);
    await waitForCapture(externalPane, 'MOUSE_WHEEL_READY');
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
    await page.mouse.wheel(0, -100);
    assert.match(await waitForCapture(externalPane, 'PROBE_MOUSE_WHEEL:'),
      /PROBE_MOUSE_WHEEL:1b5b3c3634[0-9a-f]*4d/,
      'tmux must forward SGR wheel reports to a TUI');

    const externalCopied = await copySentinelWithDrag(page, externalPane);

    await page.evaluate(() => navigator.clipboard.writeText("printf 'PASTE_OK\\n'"));
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+Shift+V');
    await page.keyboard.press('Enter');
    await waitForCaptureCount(externalPane, 'PASTE_OK', 2);

    await tmux(externalPane, 'send-keys', '-t', externalPane.target, `python3 ${probe} ime`, 'Enter');
    await waitForCapture(externalPane, 'IME_READY');
    await page.locator('.xterm-helper-textarea').evaluate((textarea) => {
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
      (textarea as HTMLTextAreaElement).value = '한글';
      textarea.dispatchEvent(new CompositionEvent('compositionupdate', { data: '한글', bubbles: true }));
      textarea.dispatchEvent(new InputEvent('input', {
        data: '한글', inputType: 'insertCompositionText', isComposing: true, bubbles: true,
      }));
      textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '한글', bubbles: true }));
    });
    assert.match(await waitForCapture(externalPane, 'PROBE_IME:'), /PROBE_IME:ed959ceab880/,
      'IME composition must commit its UTF-8 text exactly once');

    const workspaceResponse = await context.request.post(`${origin}/api/workspace`, {
      data: { directory: temporary, name: 'Managed browser semantics' },
    });
    assert.equal(workspaceResponse.status(), 200, await workspaceResponse.text());
    const workspace = await workspaceResponse.json() as { id: string };
    const activeResponse = await context.request.patch(`${origin}/api/workspace/active`, {
      data: { activeWorkspaceId: workspace.id },
    });
    assert.equal(activeResponse.status(), 200, await activeResponse.text());
    const layoutResponse = await context.request.get(`${origin}/api/layout?workspace=${workspace.id}`);
    assert.equal(layoutResponse.status(), 200, await layoutResponse.text());
    const layout = await layoutResponse.json() as {
      root: { type: 'pane'; tabs: Array<{ id: string; sessionName: string }> };
    };
    assert.equal(layout.root.type, 'pane', 'managed baseline should start with one pane');
    const managedTab = layout.root.tabs[0];
    assert(managedTab, 'managed baseline has no terminal tab');
    const managedPane: ITmuxPane = {
      selector: ['-L', 'purple'],
      target: managedTab.sessionName,
    };
    managedSession = managedTab.sessionName;
    const managedPage = await context.newPage();
    let managedOutputReady!: () => void;
    const firstManagedOutput = new Promise<void>((resolve) => { managedOutputReady = resolve; });
    managedPage.on('websocket', (websocket) => {
      if (websocket.url().includes('/api/terminal')) {
        websocket.on('framereceived', ({ payload }) => {
          if (typeof payload !== 'string') managedOutputReady();
        });
      }
    });
    await managedPage.goto(`${origin}/?workspace=${workspace.id}&tab=${managedTab.id}`);
    await terminalScreen(managedPage).waitFor({ state: 'visible', timeout: 30_000 });
    await Promise.race([
      firstManagedOutput,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Managed terminal output did not connect')), 10_000)),
    ]);
    const managedCopied = await copySentinelWithDrag(managedPage, managedPane);
    assert.equal(managedCopied, externalCopied,
      'external drag/select/copy behavior must match the managed terminal baseline');
    await managedPage.close();

    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const touchPage = await openTerminal(touchContext, origin);
    await touchPage.waitForTimeout(500);
    await tmux(externalPane, 'send-keys', '-t', externalPane.target, 'C-l');
    await touchPage.evaluate(() => {
      const screen = document.querySelector('.xterm-screen');
      const terminal = screen?.closest('.xterm')?.parentElement;
      if (!screen || !terminal) throw new Error('terminal touch surface unavailable');
      (window as typeof window & { __terminalWheelDelta?: number }).__terminalWheelDelta = 0;
      screen.addEventListener('wheel', (event) => {
        (window as typeof window & { __terminalWheelDelta?: number }).__terminalWheelDelta =
          (event as WheelEvent).deltaY;
      }, { once: true });
      const startTouch = new Touch({
        identifier: 1, target: terminal, clientX: 100, clientY: 500,
      });
      const moveTouch = new Touch({
        identifier: 1, target: terminal, clientX: 100, clientY: 450,
      });
      terminal.dispatchEvent(new TouchEvent('touchstart', {
        touches: [startTouch], bubbles: true, cancelable: true,
      }));
      terminal.dispatchEvent(new TouchEvent('touchmove', {
        touches: [moveTouch], bubbles: true, cancelable: true,
      }));
    });
    const wheelDelta = await touchPage.evaluate(() =>
      (window as typeof window & { __terminalWheelDelta?: number }).__terminalWheelDelta);
    assert.equal(wheelDelta, 50, 'mobile touch movement must become a wheel event on xterm');
    await touchContext.close();

    console.log('Browser terminal semantics verified in real Chrome.');
    await context.close();
  } catch (error) {
    console.error(serverLog);
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 10_000))]);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
    if (managedSession) {
      await execFileAsync('tmux', ['-L', 'purple', 'kill-session', '-t', `=${managedSession}`]).catch(() => {});
    }
    await execFileAsync('tmux', ['-S', socket, 'kill-server']).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
