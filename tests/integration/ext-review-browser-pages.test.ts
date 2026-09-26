// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeStdout, MSG_HEARTBEAT } from '@/lib/terminal-protocol';

const terminal = vi.hoisted(() => ({ write: vi.fn(), options: vi.fn() }));
const viewport = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/use-terminal', () => ({ default: (options: unknown) => {
  terminal.options(options);
  return { terminalRef: () => {}, write: terminal.write, isReady: true };
} }));
vi.mock('@/hooks/use-terminal-theme', () => ({ default: () => ({ theme: { colors: {} } }) }));
vi.mock('@/lib/require-auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/load-messages', () => ({ loadMessagesServer: vi.fn() }));
vi.mock('@/hooks/use-is-mobile', () => ({ default: () => viewport.mobile }));
vi.mock('next/router', () => ({ useRouter: () => ({ pathname: '/external-server', push: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/head', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next/dynamic', () => ({ default: () => ({ reviewId, windowId, externalTerminalTarget }: {
  reviewId?: string;
  windowId?: string;
  externalTerminalTarget?: { serverId: string; sessionId: string; windowId: string };
}) => createElement('div', { 'data-testid': externalTerminalTarget ? 'external-terminal' : 'viewer' },
  externalTerminalTarget
    ? `${externalTerminalTarget.serverId}:${externalTerminalTarget.sessionId}:${externalTerminalTarget.windowId}`
    : `${reviewId}:${windowId}`) }));

import ReviewTerminal from '@/components/features/ext-review/review-terminal';
import ExtReviewsPage from '@/pages/ext-review';
import ExtReviewPage from '@/pages/ext-review/[id]';
import ExternalServersPage from '@/pages/external-server';

class ObservationSocket {
  static OPEN = 1;
  static instances: ObservationSocket[] = [];
  readyState = 1;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) { ObservationSocket.instances.push(this); }
}
const review = { id: 'review-test', socketPath: '/known/socket', sessionId: '$1', windowIds: ['@2', '@4'], createdAt: '2026-09-16' };
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
const mount = (component: React.ReactNode) => render(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, component));

beforeEach(() => {
  vi.clearAllMocks();
  viewport.mobile = false;
  ObservationSocket.instances = [];
  window.sessionStorage.clear();
  vi.stubGlobal('WebSocket', ObservationSocket);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('external Review browser pages', () => {
  it('observes binary output and sends only heartbeats, blocks paste, and cleans up', () => {
    vi.useFakeTimers();
    const view = render(createElement(ReviewTerminal, { reviewId: 'review-test', windowId: '@2' }));
    const ws = ObservationSocket.instances[0];
    const url = new URL(ws.url);
    expect(url.pathname).toBe('/api/ext-review-terminal');
    expect([...url.searchParams.entries()]).toEqual([['reviewId', 'review-test'], ['windowId', '@2']]);
    expect(terminal.options).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }));
    expect(ws.binaryType).toBe('arraybuffer');
    act(() => ws.onopen?.());
    const frame = encodeStdout('\x1b[8;30;90tSCREEN');
    act(() => ws.onmessage?.({ data: frame.buffer as ArrayBuffer }));
    expect(terminal.write).toHaveBeenCalledWith(frame.slice(1));
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    view.container.querySelector('.overflow-auto')!.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    fireEvent.keyDown(view.container, { key: 'a' });
    window.dispatchEvent(new Event('resize'));
    act(() => vi.advanceTimersByTime(50_000));
    expect(ws.send).toHaveBeenCalledTimes(3);
    for (const [message] of ws.send.mock.calls) expect([...new Uint8Array(message)]).toEqual([MSG_HEARTBEAT]);
    act(() => ws.onclose?.({ code: 1011, reason: 'Frozen review targets are unavailable' }));
    expect(screen.getByRole('status').textContent).toContain('external targets are unavailable');
    act(() => ws.onclose?.({ code: 1000, reason: 'Review deleted' }));
    expect(screen.getByRole('status').textContent).toBe('This Review was deleted.');
    view.unmount();
    expect(ws.close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(50_000);
    expect(ws.send).toHaveBeenCalledTimes(3);
  });

  it('lists persisted Reviews, creates from explicit fields, opens, and deletes definitions', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response(review, 201);
      if (init?.method === 'DELETE') return response({ deleted: true });
      return response({ reviews: [review] });
    });
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExtReviewsPage));
    expect((await screen.findByRole('link', { name: 'Open' })).getAttribute('href')).toBe('/ext-review/review-test');
    fireEvent.change(screen.getByLabelText('Absolute socket path'), { target: { value: '/known/socket' } });
    fireEvent.change(screen.getByLabelText('Exact session name or $sessionId'), { target: { value: '$1' } });
    fireEvent.change(screen.getByLabelText('Approved @window IDs (spaces or commas)'), { target: { value: '@2, @4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Review' }));
    await screen.findByText('Created Review review-test.');
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(createCall[1]?.body))).toEqual({ socketPath: '/known/socket', session: '$1', windowTargets: ['@2', '@4'] });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Review definition deleted.');
    expect(fetchMock).toHaveBeenCalledWith('/api/cli/ext-reviews/review-test', { method: 'DELETE' });
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith('/api/cli/ext-reviews'))).toBe(true);
  });

  it('shows only approved windows and removes the viewer when a Review becomes unavailable or deleted', async () => {
    let status = 200;
    vi.stubGlobal('fetch', vi.fn(async () => response(review, status)));
    mount(createElement(ExtReviewPage, { id: review.id }));
    expect((await screen.findByTestId('viewer')).textContent).toBe('review-test:@2');
    const nav = screen.getByRole('navigation', { name: 'Approved windows' });
    expect(nav.textContent).toBe('@2@4');
    fireEvent.click(screen.getByRole('button', { name: '@4' }));
    expect(screen.getByTestId('viewer').textContent).toBe('review-test:@4');
    status = 409;
    fireEvent.focus(window);
    // Remount with a fresh cache to simulate a later availability check.
    cleanup();
    mount(createElement(ExtReviewPage, { id: review.id }));
    expect((await screen.findByRole('alert')).textContent).toContain('external targets are unavailable');
    expect(screen.queryByTestId('viewer')).toBeNull();
    status = 404;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('deleted or does not exist'));
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});

describe('external server browser page', () => {
  const tab = (id: string, name: string, order: number, active = false) => ({
    id, workspaceId: '$1', name, order, active, panes: [],
    externalTerminalTarget: { serverId: 'server-1', sessionId: '$1', windowId: id },
  });
  const externalSource = (tabs = [tab('@2', 'first', 0, true)]) => ({
    serverId: 'server-1', name: 'dev', exists: true,
    workspaces: [{ id: '$1', name: 'shells', sessionCreated: '1750000000', attached: false, tabs }],
  });
  const fetchFor = (getSource: () => ReturnType<typeof externalSource>) => vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return response({
      tabId: '@9', workspaceId: '$1', sessionCreated: '1750000000',
      externalTerminalTarget: { serverId: 'server-1', sessionId: '$1', windowId: '@9' },
    }, 201);
    if (url.endsWith('/workspaces')) return response(getSource());
    return response({ servers: [{ id: 'server-1', name: 'dev' }] });
  });

  it('reuses the Workspace sidebar and Tab bar without managed-only controls', async () => {
    vi.stubGlobal('fetch', fetchFor(() => externalSource([
      tab('@2', 'first', 0, true), tab('@4', 'second', 1),
    ])));
    mount(createElement(ExternalServersPage));

    expect((await screen.findByTestId('external-terminal')).textContent).toBe('server-1:$1:@2');
    expect(screen.getByRole('navigation', { name: 'Workspace list' }).getAttribute('data-workspace-source')).toBe('external');
    expect(screen.getByRole('navigation', { name: 'Workspace list' }).textContent).toContain('shells');
    expect(screen.getByRole('tablist').textContent).toContain('first');
    expect(screen.queryByText(/owned by purplemux/i)).toBeNull();
    expect(screen.queryByText('SESSIONS')).toBeNull();
    expect(screen.queryByLabelText('closeTabLabel')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'second' }));
    expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$1:@4');
  });

  it('refreshes live stable-ID additions and falls back when the selected window disappears', async () => {
    vi.useFakeTimers();
    let source = externalSource();
    vi.stubGlobal('fetch', fetchFor(() => source));
    mount(createElement(ExternalServersPage));
    await act(async () => { await Promise.resolve(); });

    source = externalSource([tab('@2', 'first', 0, true), tab('@4', 'second', 1)]);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    fireEvent.click(screen.getByRole('tab', { name: 'second' }));
    expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$1:@4');

    source = externalSource();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole('tab', { name: 'second' })).toBeNull();
    expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$1:@2');
  });

  it('uses the shared + affordance to create in the exact Workspace and selects the returned stable ID', async () => {
    const fetchMock = fetchFor(() => externalSource());
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalServersPage));

    fireEvent.click(await screen.findByRole('button', { name: 'openNewTab' }));
    await waitFor(() => expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$1:@9'));
    const creation = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(creation[0]).toBe('/api/cli/external-servers/server-1/workspaces/%241/tabs');
    expect(JSON.parse(String(creation[1]?.body))).toEqual({ sessionCreated: '1750000000' });
  });

  it('reuses mobile Workspace/Tab chrome while withholding managed Git, agent, and lifecycle controls', async () => {
    viewport.mobile = true;
    vi.stubGlobal('fetch', fetchFor(() => externalSource()));
    mount(createElement(ExternalServersPage));

    expect((await screen.findByTestId('external-terminal')).textContent).toBe('server-1:$1:@2');
    expect(document.querySelector('[data-ui-chrome="header"]')).toBeTruthy();
    expect(document.querySelector('[data-ui-chrome="tab-bar"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'newTab' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Git' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'closeTab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select tab mode' })).toBeNull();
  });
});
