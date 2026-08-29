import { findTab } from '@/lib/tab-location';
import { hasSession, sendKeySequence, sendLiteralText } from '@/lib/tmux';

const SUBMIT_DELAY_MS = 250;
const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';

const globalInputRuntime = globalThis as unknown as {
  __pmuxTabInputQueues?: Map<string, Promise<void>>;
};
if (!globalInputRuntime.__pmuxTabInputQueues) {
  globalInputRuntime.__pmuxTabInputQueues = new Map();
}
const inputQueues = globalInputRuntime.__pmuxTabInputQueues;

type TErrorBody = { error: string };

export class TabInputRuntimeError extends Error {
  readonly status: number;
  readonly body: TErrorBody;

  constructor(status: number, error: string) {
    super(error);
    this.name = 'TabInputRuntimeError';
    this.status = status;
    this.body = { error };
  }
}

export interface ITabInputRuntimeOptions {
  workspaceId: string;
  tabId: string;
}

export interface ISubmitTabInputOptions extends ITabInputRuntimeOptions {
  content: string;
}

export interface ITabInputRuntimeDependencies {
  findTab: typeof findTab;
  hasSession: typeof hasSession;
  sendLiteralText: typeof sendLiteralText;
  sendKeySequence: typeof sendKeySequence;
  delay: (ms: number) => Promise<void>;
}

const defaultDependencies: ITabInputRuntimeDependencies = {
  findTab,
  hasSession,
  sendLiteralText,
  sendKeySequence,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const resolveLiveSession = async (
  options: ITabInputRuntimeOptions,
  dependencies: ITabInputRuntimeDependencies,
): Promise<string> => {
  const found = await dependencies.findTab(options.workspaceId, options.tabId);
  if (!found) throw new TabInputRuntimeError(404, 'Tab not found');
  if (!(await dependencies.hasSession(found.tab.sessionName))) {
    throw new TabInputRuntimeError(409, 'Tab session is not running');
  }
  return found.tab.sessionName;
};

const withSessionInputLock = async <T>(
  sessionName: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = inputQueues.get(sessionName) ?? Promise.resolve();
  let release!: () => void;
  const ticket = new Promise<void>((resolve) => {
    release = resolve;
  });
  inputQueues.set(sessionName, ticket);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (inputQueues.get(sessionName) === ticket) inputQueues.delete(sessionName);
  }
};

/**
 * Canonical agent-composer submit semantics shared by Browser UI and CLI.
 * Single-line text is written literally; multiline text uses bracketed paste.
 * Both paths wait briefly before one discrete Enter keypress.
 */
export const submitTabInput = async (
  options: ISubmitTabInputOptions,
  dependencies: ITabInputRuntimeDependencies = defaultDependencies,
): Promise<void> => {
  if (typeof options.content !== 'string' || options.content.trim() === '') {
    throw new TabInputRuntimeError(400, 'content must not be blank');
  }

  const sessionName = await resolveLiveSession(options, dependencies);
  const content = options.content.includes('\n')
    ? `${BRACKETED_PASTE_START}${options.content}${BRACKETED_PASTE_END}`
    : options.content;
  await withSessionInputLock(sessionName, async () => {
    await dependencies.sendLiteralText(sessionName, content);
    await dependencies.delay(SUBMIT_DELAY_MS);
    await dependencies.sendKeySequence(sessionName, ['Enter']);
  });
};

/** Send the UI-compatible ESC ESC interrupt sequence without changing agent state. */
export const interruptTab = async (
  options: ITabInputRuntimeOptions,
  dependencies: ITabInputRuntimeDependencies = defaultDependencies,
): Promise<void> => {
  const sessionName = await resolveLiveSession(options, dependencies);
  await withSessionInputLock(sessionName, () =>
    dependencies.sendKeySequence(sessionName, ['Escape', 'Escape']));
};

export { SUBMIT_DELAY_MS };
