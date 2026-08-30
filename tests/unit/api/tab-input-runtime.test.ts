import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  submitTabInput: vi.fn(),
  interruptTab: vi.fn(),
}));

vi.mock('@/lib/cli-token', () => ({ verifyCliToken: () => true }));
vi.mock('@/lib/tab-input-runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tab-input-runtime')>(),
  submitTabInput: mocks.submitTabInput,
  interruptTab: mocks.interruptTab,
}));

import uiSubmitHandler, { config as uiSubmitConfig } from '@/pages/api/tabs/[tabId]/submit';
import uiInterruptHandler from '@/pages/api/tabs/[tabId]/interrupt';
import cliSendHandler from '@/pages/api/cli/tabs/[tabId]/send';
import cliInterruptHandler from '@/pages/api/cli/tabs/[tabId]/interrupt';

const makeResponse = () => {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return response as typeof response & NextApiResponse;
};

const request = (body?: unknown) => ({
  method: 'POST',
  headers: {},
  query: { workspaceId: 'ws-1', tabId: 'tab-1' },
  body,
}) as unknown as NextApiRequest;

describe('tab input API entry points', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserves the former terminal WebSocket payload ceiling for Browser submit', () => {
    expect(uiSubmitConfig.api.bodyParser.sizeLimit).toBe('100mb');
  });

  it.each([
    ['Browser UI', uiSubmitHandler],
    ['CLI', cliSendHandler],
  ])('routes %s submit through submitTabInput', async (_name, handler) => {
    const res = makeResponse();
    await handler(request({ content: 'hello' }), res);

    expect(mocks.submitTabInput).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      content: 'hello',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'sent' });
  });

  it.each([
    ['Browser UI', uiInterruptHandler],
    ['CLI', cliInterruptHandler],
  ])('routes %s interrupt through interruptTab', async (_name, handler) => {
    const res = makeResponse();
    await handler(request(), res);

    expect(mocks.interruptTab).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      tabId: 'tab-1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'interrupted' });
  });
});
