import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getPromptBlockFromSnapshot,
  getPromptSnapshotIdentity,
  type ITerminalPromptLine,
} from '@/lib/terminal-prompt-copy';
import { capturePaneContentWithHistory } from '@/lib/tmux';

const sessions: string[] = [];
const directories: string[] = [];
const tmux = (...args: string[]) => execFileSync('tmux', ['-L', 'purple', ...args], { encoding: 'utf8' });

const createBuffer = (rows: string[]) => ({
  length: rows.length,
  getLine: (row: number): ITerminalPromptLine | undefined => rows[row] === undefined ? undefined : ({
    isWrapped: false,
    translateToString: (trimRight = false) => trimRight ? rows[row].trimEnd() : rows[row],
  }),
});

const startSession = (session: string, command: string, cols = 30) => {
  sessions.push(session);
  tmux('-f', `${process.cwd()}/src/config/tmux.conf`, 'new-session', '-d', '-s', session,
    '-x', String(cols), '-y', '8', `sh -c "${command}"`);
};

afterEach(() => {
  for (const session of sessions.splice(0)) {
    try { tmux('kill-session', '-t', session); } catch { /* session already exited */ }
  }
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('terminal prompt copy tmux history', () => {
  it('copies a long block from tmux history beyond the visible viewport', async () => {
    const session = `pt-issue-59-${process.pid}-${Date.now()}`;
    const wrapped = `WRAPPED_${'x'.repeat(70)}`;
    const command = [
      "printf 'user@host:~$ first\\n'",
      "seq -f 'OUTPUT_%04g' 1 130",
      `printf '${wrapped}\\n'`,
      "printf 'user@host:~$ second\\nSECOND_OUTPUT\\n'",
      'sleep 30',
    ].join('; ');

    startSession(session, command);
    await vi.waitFor(() => {
      expect(tmux('capture-pane', '-p', '-t', session)).toContain('SECOND_OUTPUT');
    }, { timeout: 10_000 });

    const snapshot = (await capturePaneContentWithHistory(session, 'all', { joinWrapped: true }))!;
    const tmuxLines = snapshot.split('\n');
    const selectedRow = tmuxLines.findIndex((line) => line.trimEnd() === 'user@host:~$ first');
    const xtermLines = tmuxLines.slice(selectedRow);
    const identity = getPromptSnapshotIdentity(createBuffer(xtermLines), 0, 'user@host:');
    expect(identity).not.toBeNull();
    const copied = getPromptBlockFromSnapshot(snapshot, identity!, 'user@host:');

    expect(copied).toContain('OUTPUT_0001');
    expect(copied).toContain('OUTPUT_0130');
    expect(copied).toContain(wrapped);
    expect(copied).not.toContain('user@host:~$ second');
    expect(copied).not.toContain('SECOND_OUTPUT');
  });

  it('uses click-local context when a later identical prompt exists beyond the viewed copy-mode block', async () => {
    const session = `pt-issue-59-repeat-${process.pid}-${Date.now()}`;
    const command = [
      "printf 'SELECTED_CONTEXT\\nuser@host:~$ repeat\\nSELECTED_OUTPUT\\n'",
      "printf 'user@host:~$ other\\nOTHER_OUTPUT\\n'",
      "printf 'LATER_CONTEXT\\nuser@host:~$ repeat\\nLATER_OUTPUT\\n'",
      'sleep 30',
    ].join('; ');
    startSession(session, command);
    await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-t', session)).toContain('LATER_OUTPUT'),
      { timeout: 10_000 });

    const snapshot = (await capturePaneContentWithHistory(session, 'all', { joinWrapped: true }))!;
    const copyModeView = ['SELECTED_CONTEXT', 'user@host:~$ repeat', 'SELECTED_OUTPUT'];
    const identity = getPromptSnapshotIdentity(createBuffer(copyModeView), 1, 'user@host:');

    expect(identity).not.toBeNull();
    expect(getPromptBlockFromSnapshot(snapshot, identity!, 'user@host:')).toBe(
      'user@host:~$ repeat\nSELECTED_OUTPUT',
    );
  });

  it('keeps the backend click snapshot immutable while later output is written', async () => {
    const session = `pt-issue-59-delay-${process.pid}-${Date.now()}`;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pmux-prompt-copy-'));
    directories.push(directory);
    const release = path.join(directory, 'release');
    const command = [
      "printf 'user@host:~$ running\\nAT_CLICK\\nPARTIAL'",
      `while [ ! -f '${release}' ]; do sleep 0.02; done`,
      "printf '_AFTER_CLICK\\nLATE_OUTPUT\\nuser@host:~$ later\\n'",
      'sleep 30',
    ].join('; ');
    startSession(session, command);
    await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-J', '-t', session)).toContain('PARTIAL'),
      { timeout: 10_000 });

    const atClick = (await capturePaneContentWithHistory(session, 'all', { joinWrapped: true }))!;
    const clickLines = atClick.split('\n').map((line) => line.trimEnd()).filter((line) => line.length > 0);
    const promptRow = clickLines.indexOf('user@host:~$ running');
    const identity = getPromptSnapshotIdentity(createBuffer(clickLines), promptRow, 'user@host:');
    expect(identity).not.toBeNull();

    fs.writeFileSync(release, 'release');
    await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-J', '-t', session)).toContain('LATE_OUTPUT'),
      { timeout: 10_000 });
    const delayedSnapshot = (await capturePaneContentWithHistory(session, 'all', { joinWrapped: true }))!;
    expect(delayedSnapshot).toContain('LATE_OUTPUT');

    expect(getPromptBlockFromSnapshot(delayedSnapshot, identity!, 'user@host:')).toBe(
      'user@host:~$ running\nAT_CLICK\nPARTIAL',
    );
  });

  it('captures wide full history beyond the default execFile buffer limit', async () => {
    const session = `pt-issue-59-wide-${process.pid}-${Date.now()}`;
    const wideLine = 'x'.repeat(280);
    const command = [
      `yes '${wideLine}' | head -n 4500`,
      "printf 'WIDE_DONE\\n'",
      'sleep 30',
    ].join('; ');
    startSession(session, command, 320);
    await vi.waitFor(() => expect(tmux('capture-pane', '-p', '-t', session)).toContain('WIDE_DONE'),
      { timeout: 10_000 });

    const snapshot = await capturePaneContentWithHistory(session, 'all', { joinWrapped: true });

    expect(snapshot).not.toBeNull();
    expect(Buffer.byteLength(snapshot!)).toBeGreaterThan(1024 * 1024);
    expect(snapshot).toContain('WIDE_DONE');
  });
});
