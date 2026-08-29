import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  interruptTab,
  submitTabInput,
  SUBMIT_DELAY_MS,
  type ITabInputRuntimeDependencies,
} from '@/lib/tab-input-runtime';

const makeDependencies = (events: string[] = []) => ({
  findTab: vi.fn(async () => ({
    workspaceId: 'ws-1',
    paneId: 'pane-1',
    tab: {
      id: 'tab-1',
      name: 'Agent',
      order: 0,
      panelType: 'codex-cli' as const,
      sessionName: 'tmux-1',
    },
  })),
  hasSession: vi.fn(async () => true),
  sendLiteralText: vi.fn(async (_session: string, text: string) => {
    events.push(`text:${text}`);
  }),
  sendKeySequence: vi.fn(async (_session: string, keys: string[]) => {
    events.push(`keys:${keys.join(',')}`);
  }),
  delay: vi.fn(async (ms: number) => {
    events.push(`delay:${ms}`);
  }),
}) as unknown as ITabInputRuntimeDependencies;

describe('tab input runtime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits single-line input literally, waits, and presses Enter once', async () => {
    const events: string[] = [];
    const dependencies = makeDependencies(events);

    await submitTabInput({ workspaceId: 'ws-1', tabId: 'tab-1', content: 'hello' }, dependencies);

    expect(events).toEqual([`text:hello`, `delay:${SUBMIT_DELAY_MS}`, 'keys:Enter']);
    expect(dependencies.sendKeySequence).toHaveBeenCalledOnce();
  });

  it('uses bracketed paste only for multiline input with the same delay and one Enter', async () => {
    const events: string[] = [];
    const dependencies = makeDependencies(events);

    await submitTabInput({ workspaceId: 'ws-1', tabId: 'tab-1', content: 'one\ntwo' }, dependencies);

    expect(events).toEqual([
      'text:\x1b[200~one\ntwo\x1b[201~',
      `delay:${SUBMIT_DELAY_MS}`,
      'keys:Enter',
    ]);
  });

  it('serializes complete submit sequences for the same tmux session', async () => {
    const events: string[] = [];
    const dependencies = makeDependencies(events);
    let releaseFirstDelay!: () => void;
    vi.mocked(dependencies.delay)
      .mockImplementationOnce(async (ms) => {
        events.push(`delay:${ms}`);
        await new Promise<void>((resolve) => {
          releaseFirstDelay = resolve;
        });
      })
      .mockImplementationOnce(async (ms) => {
        events.push(`delay:${ms}`);
      });

    const first = submitTabInput(
      { workspaceId: 'ws-1', tabId: 'tab-1', content: 'first' },
      dependencies,
    );
    await vi.waitFor(() => expect(events).toEqual(['text:first', `delay:${SUBMIT_DELAY_MS}`]));
    const second = submitTabInput(
      { workspaceId: 'ws-1', tabId: 'tab-1', content: 'second' },
      dependencies,
    );
    await Promise.resolve();

    expect(events).toEqual(['text:first', `delay:${SUBMIT_DELAY_MS}`]);
    releaseFirstDelay();
    await Promise.all([first, second]);
    expect(events).toEqual([
      'text:first',
      `delay:${SUBMIT_DELAY_MS}`,
      'keys:Enter',
      'text:second',
      `delay:${SUBMIT_DELAY_MS}`,
      'keys:Enter',
    ]);
  });

  it.each(['', ' ', '\n\t'])('rejects blank input without touching tmux (%j)', async (content) => {
    const dependencies = makeDependencies();

    await expect(submitTabInput({ workspaceId: 'ws-1', tabId: 'tab-1', content }, dependencies))
      .rejects.toEqual(expect.objectContaining({ status: 400 }));

    expect(dependencies.findTab).not.toHaveBeenCalled();
    expect(dependencies.sendLiteralText).not.toHaveBeenCalled();
  });

  it('reports a missing tab and dead session without writing input', async () => {
    const missing = makeDependencies();
    vi.mocked(missing.findTab).mockResolvedValueOnce(null);
    await expect(submitTabInput({ workspaceId: 'ws-1', tabId: 'missing', content: 'hi' }, missing))
      .rejects.toEqual(expect.objectContaining({ status: 404 }));

    const dead = makeDependencies();
    vi.mocked(dead.hasSession).mockResolvedValueOnce(false);
    await expect(submitTabInput({ workspaceId: 'ws-1', tabId: 'tab-1', content: 'hi' }, dead))
      .rejects.toEqual(expect.objectContaining({ status: 409 }));
    expect(dead.sendLiteralText).not.toHaveBeenCalled();
  });

  it('interrupts with ESC ESC and does not interact with StatusManager', async () => {
    const events: string[] = [];
    const dependencies = makeDependencies(events);

    await interruptTab({ workspaceId: 'ws-1', tabId: 'tab-1' }, dependencies);

    expect(events).toEqual(['keys:Escape,Escape']);
    expect(dependencies.sendLiteralText).not.toHaveBeenCalled();
    expect(Object.keys(dependencies)).not.toContain('getStatusManager');
  });

  it('rejects interrupt for a missing or dead session', async () => {
    const missing = makeDependencies();
    vi.mocked(missing.findTab).mockResolvedValueOnce(null);
    await expect(interruptTab({ workspaceId: 'ws-1', tabId: 'missing' }, missing))
      .rejects.toEqual(expect.objectContaining({ status: 404 }));

    const dead = makeDependencies();
    vi.mocked(dead.hasSession).mockResolvedValueOnce(false);
    await expect(interruptTab({ workspaceId: 'ws-1', tabId: 'tab-1' }, dead))
      .rejects.toEqual(expect.objectContaining({ status: 409 }));
    expect(dead.sendKeySequence).not.toHaveBeenCalled();
  });
});
