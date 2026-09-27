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

const tmux = async (socket: string, ...args: string[]): Promise<string> => {
  const { stdout } = await execFileAsync('tmux', ['-S', socket, ...args]);
  return stdout;
};

const capture = (socket: string): Promise<string> =>
  tmux(socket, 'capture-pane', '-p', '-J', '-S', '-200', '-t', 'browser-terminal:0.0');

const waitForClient = async (socket: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const flags = (await tmux(socket, 'list-clients', '-F', '#{client_flags}')).trim().split('\n');
      if (flags.some((value) => value && !value.includes('no-output'))) return;
    } catch { /* the first external client is still attaching */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the external tmux client');
};

const waitForCapture = async (socket: string, text: string, timeout = 10_000): Promise<string> => {
  const deadline = Date.now() + timeout;
  let contents = '';
  while (Date.now() < deadline) {
    contents = await capture(socket);
    if (contents.includes(text)) return contents;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for terminal output: ${text}\n${contents}`);
};

const waitForTmuxValue = async (socket: string, format: string, expected: string): Promise<void> => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = (await tmux(
      socket, 'display-message', '-p', '-t', 'browser-terminal:0.0', format,
    )).trim();
    if (value === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for tmux ${format}=${expected}`);
};

const waitForCaptureCount = async (socket: string, text: string, count: number): Promise<string> => {
  const deadline = Date.now() + 10_000;
  let contents = '';
  while (Date.now() < deadline) {
    contents = await capture(socket);
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

const main = async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-browser-terminal-'));
  const socket = path.join(temporary, 'external.sock');
  const probe = path.join(temporary, 'input-probe.py');
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  let server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let serverLog = '';

  try {
    await fs.writeFile(probe, String.raw`import os, select, sys, termios, tty
mode = sys.argv[1]
fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
tty.setraw(fd)
if mode == "mouse":
    os.write(sys.stdout.fileno(), b"\x1b[?1000h\x1b[?1006hMOUSE_READY\r\n")
else:
    os.write(sys.stdout.fileno(), (mode.upper() + "_READY\r\n").encode())
data = b""
deadline = 2.0
while True:
    readable, _, _ = select.select([fd], [], [], deadline)
    if not readable:
        break
    data += os.read(fd, 64)
    if mode == "plain" or data.endswith((b"M", b"m")):
        break
if mode == "mouse":
    os.write(sys.stdout.fileno(), b"\x1b[?1000l\x1b[?1006l")
termios.tcsetattr(fd, termios.TCSADRAIN, old)
print("PROBE_" + mode.upper() + ":" + data.hex(), flush=True)
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
    await waitForClient(socket);
    await Promise.race([
      firstTerminalOutput,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Terminal output did not connect')), 10_000)),
    ]);
    if ((await tmux(socket, 'display-message', '-p', '-t', 'browser-terminal:0.0', '#{pane_in_mode}')).trim() === '1') {
      await tmux(socket, 'send-keys', '-t', 'browser-terminal:0.0', '-X', 'cancel');
    }

    await tmux(socket, 'send-keys', '-t', 'browser-terminal:0.0', `python3 ${probe} keyboard`, 'Enter');
    await waitForCapture(socket, 'KEYBOARD_READY');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('k');
    assert.match(await waitForCapture(socket, 'PROBE_KEYBOARD:'), /PROBE_KEYBOARD:6b/,
      'a real browser key event must reach the external PTY');
    await typeCommand(page, "printf 'KEYBOARD_OK\\n'");
    await waitForCaptureCount(socket, 'KEYBOARD_OK', 2);

    await typeCommand(page, `python3 ${probe} plain`);
    await waitForCapture(socket, 'PLAIN_READY');
    const box = await terminalScreen(page).boundingBox();
    assert(box, 'terminal screen has no browser geometry');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('q');
    assert.match(await waitForCapture(socket, 'PROBE_PLAIN:'), /PROBE_PLAIN:71/,
      'a browser click must not become PTY text when mouse reporting is disabled');

    await typeCommand(page, "for i in $(seq 1 80); do printf 'SCROLL_%03d\\n' \"$i\"; done");
    await waitForCapture(socket, 'SCROLL_080');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await waitForTmuxValue(socket, '#{pane_in_mode}', '1');
    await tmux(socket, 'send-keys', '-t', 'browser-terminal:0.0', '-X', 'cancel');

    await typeCommand(page, `python3 ${probe} mouse`);
    await waitForCapture(socket, 'MOUSE_READY');
    await page.mouse.click(box.x + box.width / 3, box.y + box.height / 3);
    assert.match(await waitForCapture(socket, 'PROBE_MOUSE:'), /PROBE_MOUSE:1b5b3c(?:30|31)[0-9a-f]*4d/,
      'tmux must forward SGR mouse reports to a TUI');

    await typeCommand(page, "printf 'COPY_BROWSER_SENTINEL\\n'");
    await waitForCaptureCount(socket, 'COPY_BROWSER_SENTINEL', 2);
    await page.evaluate(() => navigator.clipboard.writeText(''));
    const rows = Number((await tmux(
      socket, 'display-message', '-p', '-t', 'browser-terminal:0.0', '#{pane_height}',
    )).trim());
    const character = await page.locator('.xterm-char-measure-element').first().boundingBox();
    assert(character, 'xterm character geometry is unavailable');
    const cellWidth = character.width / 32;
    const cellHeight = character.height;
    const selectionY = box.y + ((rows - 0.5) * cellHeight);
    await page.mouse.move(box.x + (0.5 * cellWidth), selectionY);
    await page.mouse.down();
    await page.mouse.move(box.x + (22.5 * cellWidth), selectionY, { steps: 10 });
    await page.mouse.up();
    let copied = '';
    const clipboardDeadline = Date.now() + 10_000;
    while (Date.now() < clipboardDeadline) {
      copied = await page.evaluate(async () => navigator.clipboard.readText());
      if (copied.includes("printf 'COPY")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(copied.includes("printf 'COPY"),
      `tmux drag selection must reach the browser clipboard, received ${JSON.stringify(copied)}`);

    await page.evaluate(() => navigator.clipboard.writeText("printf 'PASTE_OK\\n'"));
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+Shift+V');
    await page.keyboard.press('Enter');
    await waitForCaptureCount(socket, 'PASTE_OK', 2);

    await tmux(socket, 'send-keys', '-t', 'browser-terminal:0.0', `python3 ${probe} ime`, 'Enter');
    await waitForCapture(socket, 'IME_READY');
    await page.locator('.xterm-helper-textarea').evaluate((textarea) => {
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
      (textarea as HTMLTextAreaElement).value = '한글';
      textarea.dispatchEvent(new CompositionEvent('compositionupdate', { data: '한글', bubbles: true }));
      textarea.dispatchEvent(new InputEvent('input', {
        data: '한글', inputType: 'insertCompositionText', isComposing: true, bubbles: true,
      }));
      textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '한글', bubbles: true }));
    });
    assert.match(await waitForCapture(socket, 'PROBE_IME:'), /PROBE_IME:ed959ceab880/,
      'IME composition must commit its UTF-8 text exactly once');

    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const touchPage = await openTerminal(touchContext, origin);
    await touchPage.waitForTimeout(500);
    await tmux(socket, 'send-keys', '-t', 'browser-terminal:0.0', 'C-l');
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
    await execFileAsync('tmux', ['-S', socket, 'kill-server']).catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
