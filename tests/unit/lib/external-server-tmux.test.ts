import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ exec: vi.fn(), execBuffer: vi.fn(), identity: vi.fn() }));
vi.mock('@/lib/tmux-target', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tmux-target')>(),
  execTmux: mocks.exec,
  execTmuxBuffer: mocks.execBuffer,
}));
vi.mock('@/lib/external-tmux-socket', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/external-tmux-socket')>(),
  frozenExternalTmuxSocketIdentity: mocks.identity,
}));

import { discoverExternalServer } from '@/lib/external-server-tmux';

describe('external tmux runtime decoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue('1:2:3');
    mocks.exec.mockResolvedValue({ stdout: '$0\t0\t@0\t0\t1\t%0\t0\t1\t123\t0\n', stderr: '' });
    mocks.execBuffer.mockImplementation(async (_target, args: string[]) => {
      const field = args.at(-1) ?? '';
      if (field === '#{pane_current_path}') {
        return { stdout: Buffer.from([0x2f, 0x74, 0x6d, 0x70, 0x2f, 0xff, 0x0a]), stderr: Buffer.alloc(0) };
      }
      const values: Record<string, string> = {
        '#{session_name}': 'external', '#{window_name}': 'shell', '#{pane_current_command}': 'bash',
      };
      return { stdout: Buffer.from(`${values[field] ?? ''}\n`), stderr: Buffer.alloc(0) };
    });
  });

  it('uses tmux 2.9-compatible enumeration and confines invalid UTF-8 to its field', async () => {
    const inventory = await discoverExternalServer({
      id: 'server', name: 'dev', socketPath: '/known/socket', socketIdentity: '1:2:3',
    });

    expect(mocks.exec.mock.calls[0][1].join(' ')).not.toContain('#{n:');
    expect(inventory).toMatchObject({ exists: true, sessions: [{ name: 'external', windows: [{
      name: 'shell', panes: [{ currentCommand: 'bash', currentPath: '/tmp/�' }],
    }] }] });
  });
});
