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
vi.mock('next/dynamic', () => ({ default: () => ({ reviewId, windowId, target }: {
  reviewId?: string;
  windowId?: string;
  target?: { kind: string; serverId: string; sessionId: string; windowId: string };
}) => createElement('div', { 'data-testid': target ? 'external-terminal' : 'viewer' },
  target
    ? `${target.serverId}:${target.sessionId}:${target.windowId}`
    : `${reviewId}:${windowId}`) }));

import ReviewTerminal from '@/components/features/ext-review/review-terminal';
import ExtReviewsPage from '@/pages/ext-review';
import ExtReviewPage from '@/pages/ext-review/[id]';
import { ExternalWorkspaceChromePage } from '@/pages/external-server';

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
  const tab = (
    id: string,
    name: string,
    order: number,
    active = false,
    workspaceId = '$1',
    serverId = 'server-1',
  ) => ({
    id, workspaceId, name, order, active, panes: [],
    externalTerminalTarget: { serverId, sessionId: workspaceId, windowId: id },
  });
  const workspace = (id: string, name: string, tabs: ReturnType<typeof tab>[]) => ({
    id, name, sessionCreated: id === '$1' ? '1750000000' : '1750000001', attached: false, tabs,
  });
  const externalSource = (
    tabs = [tab('@2', 'first', 0, true)],
    serverId = 'server-1',
    name = 'dev',
  ) => ({
    serverId, name, exists: true,
    workspaces: [workspace('$1', 'shells', tabs)],
  });
  const mixedExternalSource = (populatedTabs = [tab('@2', 'first', 0, true)]) => ({
    ...externalSource(populatedTabs),
    workspaces: [
      workspace('$1', 'populated', populatedTabs),
      workspace('$2', 'empty', []),
    ],
  });
  const fetchFor = (getSource: () => ReturnType<typeof externalSource>) => vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const input = JSON.parse(String(init.body)) as { requestId: string };
      const workspaceId = decodeURIComponent(url.match(/\/workspaces\/([^/]+)\/tabs$/)?.[1] ?? '');
      const selectedWorkspace = getSource().workspaces.find((candidate) => candidate.id === workspaceId)!;
      return response({
        tabId: '@9', workspaceId, sessionCreated: selectedWorkspace.sessionCreated,
        requestId: input.requestId,
        externalTerminalTarget: { serverId: 'server-1', sessionId: workspaceId, windowId: '@9' },
      }, 201);
    }
    if (url.startsWith('/api/tmux/capture?')) return response({ content: 'captured external pane' });
    if (url.endsWith('/workspaces')) return response(getSource());
    return response({ servers: [{
      id: 'server-1', name: 'dev', socketPath: '/tmp/dev.sock', socketIdentity: '1:2:3',
      exists: true, sessions: [],
    }] });
  });

  it('reuses the Workspace sidebar and Tab bar without managed-only controls', async () => {
    vi.stubGlobal('fetch', fetchFor(() => externalSource([
      tab('@2', 'first', 0, true), tab('@4', 'second', 1),
    ])));
    mount(createElement(ExternalWorkspaceChromePage));

    expect((await screen.findByTestId('external-terminal')).textContent).toBe('server-1:$1:@2');
    expect(screen.getByText('External tmux · dev')).toBeTruthy();
    expect((screen.getByLabelText('REGISTERED SERVER') as HTMLSelectElement).value).toBe('server-1');
    expect(screen.getByText('/tmp/dev.sock')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'workspaceList' }).getAttribute('data-workspace-source')).toBe('external');
    expect(screen.getByRole('navigation', { name: 'workspaceList' }).textContent).toContain('shells');
    expect(screen.getByRole('tablist').textContent).toContain('first');
    expect(screen.queryByText(/owned by purplemux/i)).toBeNull();
    expect(screen.queryByText('SESSIONS')).toBeNull();
    expect(screen.queryByLabelText('closeTabLabel')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'second' }));
    expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$1:@4');
  });

  it('keeps linked window tabs distinct within and across external Workspaces', async () => {
    const linkedWindow = tab('@2', 'linked', 4, false);
    const source = {
      ...externalSource(),
      workspaces: [
        workspace('$1', 'original', [tab('@2', 'linked', 0, true), linkedWindow]),
        workspace('$2', 'other session', [tab('@2', 'linked', 3, true, '$2')]),
      ],
    };
    vi.stubGlobal('fetch', fetchFor(() => source));
    mount(createElement(ExternalWorkspaceChromePage));

    const linkedTabs = await screen.findAllByRole('tab', { name: 'linked' });
    expect(linkedTabs).toHaveLength(2);
    expect(linkedTabs.map((element) => element.getAttribute('data-tab-id'))).toEqual([
      'server-1:$1:@2:0', 'server-1:$1:@2:4',
    ]);
    fireEvent.click(linkedTabs[1]);
    expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$1:@2');

    fireEvent.click(screen.getByRole('button', { name: 'other session' }));
    expect(screen.getByRole('tab', { name: 'linked' }).getAttribute('data-tab-id'))
      .toBe('server-1:$2:@2');
    expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$2:@2');
  });

  it('selects one registered server explicitly without flattening server workspaces together', async () => {
    const dev = externalSource(undefined, 'server-1', 'dev');
    const prod = {
      ...externalSource([tab('@7', 'prod-window', 0, true, '$1', 'server-2')], 'server-2', 'prod'),
      workspaces: [workspace('$1', 'production', [
        tab('@7', 'prod-window', 0, true, '$1', 'server-2'),
      ])],
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/server-1/workspaces')) return response(dev);
      if (url.endsWith('/server-2/workspaces')) return response(prod);
      return response({ servers: [
        { id: 'server-1', name: 'dev', socketPath: '/tmp/dev.sock', exists: true },
        { id: 'server-2', name: 'prod', socketPath: '/tmp/prod.sock', exists: true },
      ] });
    }));
    mount(createElement(ExternalWorkspaceChromePage));

    expect((await screen.findByTestId('external-terminal')).textContent).toBe('server-1:$1:@2');
    expect(screen.getByRole('navigation', { name: 'workspaceList' }).textContent).not.toContain('production');
    fireEvent.change(screen.getByLabelText('REGISTERED SERVER'), { target: { value: 'server-2' } });
    await waitFor(() => expect(screen.getByTestId('external-terminal').textContent).toBe('server-2:$1:@7'));
    expect(screen.getByText('External tmux · prod')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'workspaceList' }).textContent).not.toContain('shells');
    expect(screen.getByRole('button', { name: 'production' })).toBeTruthy();
  });

  it('preserves no-registration, empty-server, and unavailable-server states', async () => {
    let servers: unknown[] = [];
    let selectedSource: unknown = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/workspaces')) return response(selectedSource);
      return response({ servers });
    }));
    const view = mount(createElement(ExternalWorkspaceChromePage));
    expect(await screen.findByText('No external tmux servers are registered.')).toBeTruthy();
    expect((screen.getByLabelText('REGISTERED SERVER') as HTMLSelectElement).disabled).toBe(true);

    view.unmount();
    servers = [{ id: 'empty', name: 'empty', socketPath: '/tmp/empty.sock', exists: true }];
    selectedSource = { serverId: 'empty', name: 'empty', exists: true, workspaces: [] };
    mount(createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } },
      createElement(ExternalWorkspaceChromePage)));
    expect(await screen.findByText('The selected external tmux server has no sessions.')).toBeTruthy();

    cleanup();
    servers = [{ id: 'offline', name: 'offline', socketPath: '/tmp/offline.sock', exists: false }];
    selectedSource = {
      serverId: 'offline', name: 'offline', exists: false, workspaces: [],
      unavailableReason: 'External tmux socket disappeared',
    };
    mount(createElement(ExternalWorkspaceChromePage));
    expect((await screen.findByRole('status')).textContent).toContain('External tmux socket disappeared');
    expect(screen.getByRole('option', { name: 'offline (unavailable)' })).toBeTruthy();
  });

  it('registers and unregisters servers from the shared shell controls', async () => {
    const registered = {
      id: 'server-new', name: 'new server', socketPath: '/tmp/new.sock',
      socketIdentity: '2:3:4', exists: true, sessions: [],
    };
    let servers: typeof registered[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        servers = [registered];
        return response(registered, 201);
      }
      if (init?.method === 'DELETE') {
        servers = [];
        return response({ deleted: true });
      }
      if (url.endsWith('/workspaces')) {
        return response({ serverId: registered.id, name: registered.name, exists: true, workspaces: [] });
      }
      return response({ servers });
    });
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalWorkspaceChromePage));
    await screen.findByText('No external tmux servers are registered.');

    fireEvent.click(screen.getByRole('button', { name: 'Register external server' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'new server' } });
    fireEvent.change(screen.getByLabelText('Absolute socket path'), { target: { value: '/tmp/new.sock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));
    await waitFor(() => expect((screen.getByLabelText('REGISTERED SERVER') as HTMLSelectElement).value)
      .toBe('server-new'));
    expect(fetchMock).toHaveBeenCalledWith('/api/cli/external-servers', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'new server', socketPath: '/tmp/new.sock' }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Unregister selected server' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unregister' }));
    expect(await screen.findByText('No external tmux servers are registered.')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/cli/external-servers/server-new', { method: 'DELETE' });
  });

  it('keeps a confirmed registration cached and selected when its follow-up refresh fails', async () => {
    const registered = {
      id: 'server-new', name: 'new server', socketPath: '/tmp/new.sock',
      socketIdentity: '2:3:4',
    };
    let registrationGets = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response(registered, 201);
      if (url.endsWith('/workspaces')) {
        return response({ serverId: registered.id, name: registered.name, exists: true, workspaces: [] });
      }
      registrationGets += 1;
      return registrationGets === 1
        ? response({ servers: [] })
        : response({ error: 'refresh failed' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalWorkspaceChromePage));
    await screen.findByText('No external tmux servers are registered.');

    fireEvent.click(screen.getByRole('button', { name: 'Register external server' }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: registered.name } });
    fireEvent.change(screen.getByLabelText('Absolute socket path'), {
      target: { value: registered.socketPath },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register' }));

    await waitFor(() => expect(registrationGets).toBe(2));
    const selector = screen.getByLabelText('REGISTERED SERVER') as HTMLSelectElement;
    expect(selector.value).toBe(registered.id);
    expect([...selector.options].map((option) => option.text)).toEqual([registered.name]);
    expect(screen.getByText('External tmux · new server')).toBeTruthy();
  });

  it('removes a confirmed unregistration and its workspaces when its follow-up refresh fails', async () => {
    const registered = {
      id: 'server-1', name: 'dev', socketPath: '/tmp/dev.sock',
      socketIdentity: '1:2:3', exists: true, sessions: [],
    };
    let registrationGets = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return response({ deleted: true });
      if (url.endsWith('/workspaces')) return response(externalSource());
      registrationGets += 1;
      return registrationGets === 1
        ? response({ servers: [registered] })
        : response({ error: 'refresh failed' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalWorkspaceChromePage));
    await screen.findByTestId('external-terminal');

    fireEvent.click(screen.getByRole('button', { name: 'Unregister selected server' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unregister' }));

    await waitFor(() => expect(registrationGets).toBe(2));
    expect(await screen.findByText('No external tmux servers are registered.')).toBeTruthy();
    expect((screen.getByLabelText('REGISTERED SERVER') as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByTestId('external-terminal')).toBeNull();
  });

  it('finishes delayed unregistration against its original server and latest inventory', async () => {
    const dev = {
      id: 'server-1', name: 'dev', socketPath: '/tmp/dev.sock', exists: true, sessions: [],
    };
    const prod = {
      id: 'server-2', name: 'prod', socketPath: '/tmp/prod.sock', exists: true, sessions: [],
    };
    const staging = {
      id: 'server-3', name: 'staging', socketPath: '/tmp/staging.sock', exists: true, sessions: [],
    };
    const prodSource = externalSource([
      tab('@7', 'prod-window', 0, true, '$1', prod.id),
    ], prod.id, prod.name);
    let inventory = [dev, prod];
    let failRegistrationReads = false;
    let resolveDelete!: () => void;
    const deletePending = new Promise<void>((resolve) => { resolveDelete = resolve; });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        await deletePending;
        return response({ deleted: true });
      }
      if (url.endsWith('/server-1/workspaces')) return response(externalSource());
      if (url.endsWith('/server-2/workspaces')) return response(prodSource);
      if (url.endsWith('/server-3/workspaces')) {
        return response({ serverId: staging.id, name: staging.name, exists: true, workspaces: [] });
      }
      if (failRegistrationReads) return response({ error: 'refresh failed' }, 500);
      return response({ servers: inventory });
    });
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalWorkspaceChromePage));
    expect((await screen.findByTestId('external-terminal')).textContent).toBe('server-1:$1:@2');

    fireEvent.click(screen.getByRole('button', { name: 'Unregister selected server' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unregister' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/cli/external-servers/server-1', { method: 'DELETE' },
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.change(screen.getByLabelText('REGISTERED SERVER'), { target: { value: prod.id } });
    await waitFor(() => expect(screen.getByTestId('external-terminal').textContent)
      .toBe('server-2:$1:@7'));

    inventory = [dev, prod, staging];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh external workspaces' }));
    await screen.findByRole('option', { name: staging.name });
    failRegistrationReads = true;
    await act(async () => { resolveDelete(); });

    await waitFor(() => expect((screen.getByRole('button', {
      name: 'Unregister selected server',
    }) as HTMLButtonElement).disabled).toBe(false));
    const selector = screen.getByLabelText('REGISTERED SERVER') as HTMLSelectElement;
    expect(selector.value).toBe(prod.id);
    expect([...selector.options].map((option) => option.text)).toEqual([prod.name, staging.name]);
    expect(screen.getByTestId('external-terminal').textContent).toBe('server-2:$1:@7');
  });

  it('refreshes live stable-ID additions and falls back when the selected window disappears', async () => {
    vi.useFakeTimers();
    let source = externalSource();
    vi.stubGlobal('fetch', fetchFor(() => source));
    mount(createElement(ExternalWorkspaceChromePage));
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
    mount(createElement(ExternalWorkspaceChromePage));

    fireEvent.click(await screen.findByRole('button', { name: 'openNewTab' }));
    await waitFor(() => expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$1:@9'));
    const creation = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(creation[0]).toBe('/api/cli/external-servers/server-1/workspaces/%241/tabs');
    expect(JSON.parse(String(creation[1]?.body))).toEqual({
      sessionCreated: '1750000000', requestId: expect.any(String),
    });
  });

  it('reuses the persisted request ID after an ambiguous tab-creation response', async () => {
    const successfulFetch = fetchFor(() => externalSource());
    let postCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && postCount++ === 0) {
        const { requestId } = JSON.parse(String(init.body)) as { requestId: string };
        return response({ error: 'outcome unknown', outcomeUnknown: true, requestId }, 503);
      }
      return successfulFetch(url, init);
    });
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalWorkspaceChromePage));

    const create = await screen.findByRole('button', { name: 'openNewTab' });
    fireEvent.click(create);
    expect(await screen.findAllByText('outcome unknown')).not.toHaveLength(0);
    fireEvent.click(create);
    await waitFor(() => expect(screen.getByTestId('external-terminal').textContent)
      .toBe('server-1:$1:@9'));

    const creations = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(creations).toHaveLength(2);
    const requestIds = creations.map(([, init]) =>
      JSON.parse(String(init?.body)).requestId as string);
    expect(requestIds[0]).toBeTruthy();
    expect(requestIds[1]).toBe(requestIds[0]);
  });

  it('retires a confirmed optimistic tab so external deletion cannot resurrect it', async () => {
    let source = externalSource();
    const fetchMock = fetchFor(() => source);
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalWorkspaceChromePage));

    fireEvent.click(await screen.findByRole('button', { name: 'openNewTab' }));
    await waitFor(() => expect(screen.getByTestId('external-terminal').textContent)
      .toBe('server-1:$1:@9'));
    source = externalSource([tab('@2', 'first', 0, true), tab('@9', 'created', 1)]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh external workspaces' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'created' })).toBeTruthy());

    source = externalSource();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh external workspaces' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'created' })).toBeNull());
    expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$1:@2');
  });

  it('keeps an empty desktop Workspace selected by stable ID while populated sessions refresh', async () => {
    vi.useFakeTimers();
    let source = mixedExternalSource();
    const fetchMock = fetchFor(() => source);
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalWorkspaceChromePage));
    await act(async () => { await Promise.resolve(); });

    fireEvent.click(screen.getByRole('button', { name: 'empty' }));
    expect(screen.getByRole('button', { name: 'empty' }).getAttribute('aria-current')).toBe('true');
    expect(screen.queryByTestId('external-terminal')).toBeNull();

    source = mixedExternalSource([tab('@2', 'first', 0, true), tab('@4', 'second', 1)]);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('button', { name: 'empty' }).getAttribute('aria-current')).toBe('true');
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: 'openNewTab' }));
    await waitFor(() => expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$2:@9'));
    const creation = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(creation[0]).toBe('/api/cli/external-servers/server-1/workspaces/%242/tabs');
  });

  it('reuses mobile Workspace/Tab chrome while withholding managed Git, agent, and lifecycle controls', async () => {
    viewport.mobile = true;
    vi.stubGlobal('fetch', fetchFor(() => externalSource()));
    mount(createElement(ExternalWorkspaceChromePage));

    expect((await screen.findByTestId('external-terminal')).textContent).toBe('server-1:$1:@2');
    expect(document.querySelector('[data-ui-chrome="header"]')).toBeTruthy();
    expect(document.querySelector('[data-ui-chrome="tab-bar"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'newTab' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'openMenu' }));
    expect((screen.getByLabelText('REGISTERED SERVER') as HTMLSelectElement).value).toBe('server-1');
    fireEvent.click(screen.getByRole('button', { name: 'closeMenu' }));
    fireEvent.click(screen.getByRole('button', { name: 'copyPaneLabel' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/tmux/capture?externalServerId=server-1&sessionId=%241&windowId=%402',
    ));
    expect(screen.queryByRole('button', { name: 'Open Git' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'closeTab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select tab mode' })).toBeNull();
  });

  it('keeps the mobile + affordance available for an empty external Workspace', async () => {
    viewport.mobile = true;
    const fetchMock = fetchFor(() => externalSource([]));
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalWorkspaceChromePage));

    fireEvent.click(await screen.findByRole('button', { name: 'newTabLabel' }));
    await waitFor(() => expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$1:@9'));
    const creation = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(creation[0]).toBe('/api/cli/external-servers/server-1/workspaces/%241/tabs');
  });

  it('selects an empty mobile Workspace independently and creates its first tab there', async () => {
    viewport.mobile = true;
    const fetchMock = fetchFor(() => mixedExternalSource());
    vi.stubGlobal('fetch', fetchMock);
    mount(createElement(ExternalWorkspaceChromePage));
    await screen.findByTestId('external-terminal');

    fireEvent.click(screen.getByRole('button', { name: 'openMenu' }));
    fireEvent.click(screen.getByRole('button', { name: 'empty' }));
    fireEvent.click(await screen.findByRole('button', { name: 'newTabLabel' }));

    await waitFor(() => expect(screen.getByTestId('external-terminal').textContent).toBe('server-1:$2:@9'));
    const creation = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(creation[0]).toBe('/api/cli/external-servers/server-1/workspaces/%242/tabs');
  });
});
