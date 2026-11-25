import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IWorkspace } from '@/types/terminal';
const fixture = vi.hoisted(() => ({ dir: '' }));
vi.mock('@/lib/layout-store', () => ({ resolveLayoutDir: () => fixture.dir }));
import { writeCodexPromptFile, getCodexPromptPath } from '@/lib/providers/codex/prompt';
import { writeClaudePromptFile, getClaudePromptPath } from '@/lib/claude-prompt';
const workspace = { id: 'ws-test', name: 'old name' } as IWorkspace;
afterEach(async () => { vi.restoreAllMocks(); if (fixture.dir) await fs.rm(fixture.dir, { recursive: true, force: true }); });
describe.each([['Codex', writeCodexPromptFile, getCodexPromptPath], ['Claude', writeClaudePromptFile, getClaudePromptPath]] as const)('%s prompt startup preservation', (_provider, writePrompt, getPromptPath) => {
async function create() { fixture.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-prompt-')); await writePrompt(workspace); return getPromptPath(workspace.id); }
 it('keeps appended contracts and arbitrary additional instructions byte-for-byte over repeated startup/workspace updates', async () => {
  const file = await create(), generated = await fs.readFile(file, 'utf8');
  const before = generated + '\n<ai-village-instructions version="2">\n固定契約\n</ai-village-instructions>\nCUSTOM "quotes"\r\n';
  await fs.writeFile(file, before); const writer = vi.spyOn(fs, 'writeFile');
  await writePrompt(workspace); await writePrompt({ ...workspace, name: 'new name' });
  expect(await fs.readFile(file, 'utf8')).toBe(before); expect(writer).not.toHaveBeenCalled();
 });
 it('preserves unknown edits rather than replacing an unrecognized template', async () => {
  const file = await create(); await fs.writeFile(file, 'custom prefix\nfixed startup instructions');
  await writePrompt(workspace); expect(await fs.readFile(file, 'utf8')).toBe('custom prefix\nfixed startup instructions');
 });
 it('fails on unreadable existing file instead of treating it as missing', async () => {
  const file = await create(), original = await fs.readFile(file, 'utf8');
  vi.spyOn(fs, 'readFile').mockRejectedValueOnce(Object.assign(Error('denied'), { code: 'EACCES' }));
  await expect(writePrompt(workspace)).rejects.toMatchObject({ code: 'EACCES' });
  expect(await fs.readFile(file, 'utf8')).toBe(original);
 });
 it('does not overwrite a contract installed between missing read and create', async () => {
  fixture.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pmux-prompt-race-')); const file = getPromptPath(workspace.id);
  vi.spyOn(fs, 'readFile').mockImplementationOnce(async () => {
   await fs.writeFile(file, 'concurrent fixed contract'); throw Object.assign(Error('missing'), { code: 'ENOENT' });
  });
  await writePrompt(workspace); expect(await fs.readFile(file, 'utf8')).toBe('concurrent fixed contract');
 });
});
