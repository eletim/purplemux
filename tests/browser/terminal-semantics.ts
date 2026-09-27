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
  env?: NodeJS.ProcessEnv;
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
  const { stdout } = await execFileAsync(
    'tmux', [...pane.selector, ...args], { encoding: 'utf8', env: pane.env },
  );
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

const waitForProbePayload = async (
  pane: ITmuxPane, label: string, timeout = 10_000,
): Promise<string> => {
  const marker = `PROBE_${label}:`;
  const deadline = Date.now() + timeout;
  let contents = '';
  while (Date.now() < deadline) {
    contents = await capture(pane);
    const line = contents.split('\n')
      .map((value) => value.trimEnd())
      .find((value) => value.startsWith(marker));
    if (line) {
      const payload = line.slice(marker.length);
      assert.match(payload, /^(?:[0-9a-f]{2})*$/,
        `${marker} must contain one complete hexadecimal payload`);
      return payload;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for terminal probe: ${marker}\n${contents}`);
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

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
};

const signalProcess = (pid: number, signal: NodeJS.Signals): void => {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
};

const waitForProcessExit = async (pids: Set<number>, timeout: number): Promise<number[]> => {
  const deadline = Date.now() + timeout;
  let live = [...pids].filter(processIsAlive);
  while (live.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    live = live.filter(processIsAlive);
  }
  return live;
};

const recordTmuxProcesses = async (pane: ITmuxPane, pids: Set<number>): Promise<void> => {
  const serverPid = Number((await tmux(pane, 'display-message', '-p', '#{pid}')).trim());
  assert(Number.isSafeInteger(serverPid) && serverPid > 0, 'tmux did not report a valid server PID');
  pids.add(serverPid);
  const clients = (await tmux(pane, 'list-clients', '-F', '#{client_pid}')).trim();
  for (const value of clients.split('\n')) {
    if (!value) continue;
    const clientPid = Number(value);
    assert(Number.isSafeInteger(clientPid) && clientPid > 0, 'tmux did not report a valid client PID');
    pids.add(clientPid);
  }
};

const terminateTmuxServer = async (pane: ITmuxPane, pids: Set<number>): Promise<void> => {
  let commandFailure: unknown;
  try {
    await recordTmuxProcesses(pane, pids);
  } catch (error) {
    commandFailure = error;
  }

  try {
    await tmux(pane, 'kill-server');
  } catch (error) {
    commandFailure ??= error;
    if (![...pids].some(processIsAlive)) return;
  }

  let live = await waitForProcessExit(pids, 3_000);
  for (const pid of live) signalProcess(pid, 'SIGTERM');
  live = await waitForProcessExit(new Set(live), 3_000);
  for (const pid of live) signalProcess(pid, 'SIGKILL');
  live = await waitForProcessExit(new Set(live), 3_000);
  if (live.length > 0) {
    const cause = commandFailure instanceof Error ? `; tmux command failed: ${commandFailure.message}` : '';
    throw new Error(`tmux processes did not exit: ${live.join(', ')}${cause}`);
  }
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
  const command = `yes ${sentinel} | head -80`;
  const inCopyMode = (await tmux(
    pane, 'display-message', '-p', '-t', pane.target, '#{pane_in_mode}',
  )).trim() === '1';
  if (inCopyMode) await tmux(pane, 'send-keys', '-t', pane.target, '-X', 'cancel');
  await tmux(pane, 'send-keys', '-l', '-t', pane.target, command);
  await tmux(pane, 'send-keys', '-t', pane.target, 'Enter');
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
  const normalizedCopied = copied.replace(/\r\n?/g, '\n').trimEnd();
  const copiedSentinels = normalizedCopied.split('\n').filter((line) => line === sentinel);
  assert(copiedSentinels.length > 1,
    `tmux drag selection must reach the browser clipboard, received ${JSON.stringify(copied)}`);
  return normalizedCopied;
};

const main = async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'purplemux-browser-terminal-'));
  const tmuxLauncherDirectory = path.join(temporary, 'bin');
  const tmuxLauncher = path.join(tmuxLauncherDirectory, 'tmux');
  const socket = path.join(temporary, 'external.sock');
  const externalPane: ITmuxPane = {
    selector: ['-S', socket],
    target: 'browser-terminal:0.0',
  };
  const managedTmuxEnv = { ...process.env, TMUX_TMPDIR: temporary };
  const probe = path.join(temporary, 'input-probe.py');
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  let server: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const externalTmuxPids = new Set<number>();
  let serverLog = '';

  try {
    const { stdout: tmuxExecutableOutput } = await execFileAsync('which', ['tmux']);
    const tmuxExecutable = tmuxExecutableOutput.trim();
    assert(path.isAbsolute(tmuxExecutable), 'tmux executable was not found on PATH');
    const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
    await fs.mkdir(tmuxLauncherDirectory);
    await fs.writeFile(tmuxLauncher,
      `#!/bin/sh\nTMUX_TMPDIR=${shellQuote(temporary)} exec ${shellQuote(tmuxExecutable)} "$@"\n`,
      { mode: 0o700 });

    await fs.writeFile(probe, String.raw`import os, select, sys, termios, tty
mode = sys.argv[1]
fd = sys.stdin.fileno()
old = termios.tcgetattr(fd)
tty.setraw(fd)
mouse = mode.startswith("mouse-")
bracketed_paste = mode == "paste"
label = mode.upper().replace("-", "_")
if mouse:
    os.write(sys.stdout.fileno(), b"\x1b[?1000h\x1b[?1006h" + label.encode() + b"_READY\r\n")
elif bracketed_paste:
    os.write(sys.stdout.fileno(), b"\x1b[?2004h" + label.encode() + b"_READY\r\n")
else:
    os.write(sys.stdout.fileno(), (label + "_READY\r\n").encode())
data = b""
deadline = 2.0
while True:
    readable, _, _ = select.select([fd], [], [], deadline)
    if not readable:
        break
    data += os.read(fd, 64)
    if ((mouse and data.endswith((b"M", b"m")))
            or (bracketed_paste and data.endswith(b"\x1b[201~"))
            or (not mouse and not bracketed_paste)):
        break
if mouse:
    os.write(sys.stdout.fileno(), b"\x1b[?1000l\x1b[?1006l")
elif bracketed_paste:
    os.write(sys.stdout.fileno(), b"\x1b[?2004l")
termios.tcsetattr(fd, termios.TCSADRAIN, old)
print("PROBE_" + label + ":" + data.hex(), flush=True)
`);

    await execFileAsync('tmux', [
      '-f', path.join(root, 'src/config/tmux.conf'), '-S', socket,
      'new-session', '-d', '-x', '100', '-y', '30', '-s', 'browser-terminal',
      'exec bash --noprofile --norc',
    ]);
    await recordTmuxProcesses(externalPane, externalTmuxPids);

    const serverEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: temporary,
      INIT_PASSWORD: password,
      PORT: String(port),
      HOST: '127.0.0.1',
      TMUX_TMPDIR: temporary,
      PATH: `${tmuxLauncherDirectory}:${process.env.PATH ?? ''}`,
      __PMUX_APP_DIR: root,
    };
    delete serverEnv.__PMUX_PRISTINE_ENV;
    server = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'server.ts'], {
      cwd: root,
      env: serverEnv,
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
    await recordTmuxProcesses(externalPane, externalTmuxPids);
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
    assert.equal(await waitForProbePayload(externalPane, 'KEYBOARD'), '6b',
      'a real browser key event must reach the external PTY');

    await typeCommand(page, `python3 ${probe} plain`);
    await waitForCapture(externalPane, 'PLAIN_READY');
    const box = await terminalScreen(page).boundingBox();
    assert(box, 'terminal screen has no browser geometry');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('q');
    assert.equal(await waitForProbePayload(externalPane, 'PLAIN'), '71',
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
    assert.equal(await waitForProbePayload(externalPane, 'WHEEL'), '71',
      'wheel input handled by tmux scrollback must not also become PTY text');

    await typeCommand(page, `python3 ${probe} mouse-click`);
    await waitForCapture(externalPane, 'MOUSE_CLICK_READY');
    await page.mouse.click(box.x + box.width / 3, box.y + box.height / 3);
    const clickReport = Buffer.from(
      await waitForProbePayload(externalPane, 'MOUSE_CLICK'), 'hex',
    ).toString('utf8');
    assert.match(clickReport, /^\x1b\[<[01];\d+;\d+M$/,
      'tmux must forward SGR click reports to a TUI');

    await typeCommand(page, `python3 ${probe} mouse-wheel`);
    await waitForCapture(externalPane, 'MOUSE_WHEEL_READY');
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3);
    await page.mouse.wheel(0, -100);
    const wheelReport = Buffer.from(
      await waitForProbePayload(externalPane, 'MOUSE_WHEEL'), 'hex',
    ).toString('utf8');
    assert.match(wheelReport, /^\x1b\[<64;\d+;\d+M$/,
      'tmux must forward SGR wheel reports to a TUI');

    const externalCopied = await copySentinelWithDrag(page, externalPane);

    const pasteText = 'PASTE_BROWSER_SENTINEL';
    await typeCommand(page, `python3 ${probe} paste`);
    await waitForCapture(externalPane, 'PASTE_READY');
    await page.evaluate((text) => navigator.clipboard.writeText(text), pasteText);
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+Shift+V');
    assert.equal(await waitForProbePayload(externalPane, 'PASTE'),
      Buffer.from(`\x1b[200~${pasteText}\x1b[201~`).toString('hex'),
      'browser paste must reach the external PTY exactly once');

    await tmux(externalPane, 'send-keys', '-t', externalPane.target, `python3 ${probe} ime`, 'Enter');
    await waitForCapture(externalPane, 'IME_READY');
    await page.locator('.xterm-helper-textarea').evaluate((textarea) => {
      const input = textarea as HTMLTextAreaElement;
      const valueBeforeComposition = input.value;
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
      input.value = `${valueBeforeComposition}한글`;
      textarea.dispatchEvent(new CompositionEvent('compositionupdate', { data: '한글', bubbles: true }));
      textarea.dispatchEvent(new InputEvent('input', {
        data: '한글', inputType: 'insertCompositionText', isComposing: true, bubbles: true,
      }));
      textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '한글', bubbles: true }));
    });
    assert.equal(await waitForProbePayload(externalPane, 'IME'),
      Buffer.from('한글').toString('hex'),
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
      env: managedTmuxEnv,
    };
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
    await managedPage.goto(origin);
    await terminalScreen(managedPage).waitFor({ state: 'visible', timeout: 30_000 });
    await Promise.race([
      firstManagedOutput,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Managed terminal output did not connect')), 10_000)),
    ]);
    await managedPage.waitForTimeout(500);
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
    await recordTmuxProcesses(externalPane, externalTmuxPids);
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
    await execFileAsync('tmux', ['-L', 'purple', 'kill-server'], { env: managedTmuxEnv }).catch(() => {});
    await terminateTmuxServer(externalPane, externalTmuxPids);
    await fs.rm(temporary, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
