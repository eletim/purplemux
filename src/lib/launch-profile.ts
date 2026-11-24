import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { HOOK_SETTINGS_PATH } from '@/lib/hook-settings';

export interface ILaunchProfile { version: 1; provider: 'claude'; model: string; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
export interface ILaunchReceipt { profile: ILaunchProfile; sessionId: string; workspaceId: string; tabId: string; sessionName: string; appliedAt: string | null }
export const launchProfileCapability = { version: 1, provider: 'claude', arguments: true, sessionStart: true };
export const parseLaunchProfile = (value: unknown): ILaunchProfile => {
  const p = value as ILaunchProfile;
  if (!p || typeof p !== 'object' || Array.isArray(p)
    || Object.keys(p).sort().join(',') !== 'effort,model,provider,version'
    || p.version !== 1 || p.provider !== 'claude'
    || typeof p.model !== 'string' || !/^claude-(?:sonnet|opus|haiku)-[0-9][a-z0-9-]*$/.test(p.model)
    || !['low', 'medium', 'high', 'xhigh', 'max'].includes(p.effort)) throw new Error('Invalid launchProfile: version 1, claude full model ID and effort required');
  return { version: 1, provider: 'claude', model: p.model, effort: p.effort };
};
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const base = () => path.join(os.homedir(), '.purplemux', 'launch-profiles');
const key = (workspaceId: string, tabId: string) => {
  if (![workspaceId, tabId].every(s => /^[a-zA-Z0-9_-]+$/.test(s))) throw new Error('Invalid launch identity');
  return path.join(base(), `${workspaceId}--${tabId}`);
};
export const checkLaunchProfileSupport = async () => {
  const { stdout } = await promisify(execFile)('claude', ['--help'], { timeout: 10000, maxBuffer: 1024 * 1024 });
  if (!['--model', '--effort', '--session-id', '--settings'].every(flag => stdout.includes(flag))) throw new Error('Installed Claude CLI does not support launchProfile');
};
// Artifacts are private to a fresh tab. Existing settings/hooks are copied, never rewritten.
export const prepareLaunchProfile = async (profile: ILaunchProfile, identity: Omit<ILaunchReceipt, 'profile' | 'sessionId' | 'appliedAt'>) => {
  const dir = key(identity.workspaceId, identity.tabId);
  await fs.mkdir(base(), { recursive: true, mode: 0o700 });
  await fs.mkdir(dir, { mode: 0o700 }); // exclusive: never reuse a launch
  const receipt: ILaunchReceipt = { ...identity, profile, sessionId: randomUUID(), appliedAt: null };
  const settings = JSON.parse(await fs.readFile(HOOK_SETTINGS_PATH, 'utf8'));
  const hookPath = path.join(dir, 'observe.cjs');
  const observationPath = path.join(dir, 'startup.json');
  const hook = `const fs=require('fs');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(input);if(p.hook_event_name!=='SessionStart')return;const record={sessionId:p.session_id,model:p.model,source:p.source,observedAt:new Date().toISOString()};fs.writeFileSync(${JSON.stringify(observationPath)},JSON.stringify(record),{flag:'wx',mode:384});}catch(e){if(e.code!=='EEXIST')process.exitCode=1;}});`;
  await fs.writeFile(hookPath, hook, { flag: 'wx', mode: 0o600 });
  settings.hooks ??= {};
  settings.hooks.SessionStart = [...(settings.hooks.SessionStart ?? []), { matcher: '', hooks: [{ type: 'command', command: `${quote(process.execPath)} ${quote(hookPath)}`, timeout: 5 }] }];
  const settingsPath = path.join(dir, 'settings.json');
  await fs.writeFile(settingsPath, JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
  await fs.writeFile(path.join(dir, 'receipt.json'), JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
  return { receipt, settingsPath };
};
export const markLaunchApplied = async (receipt: ILaunchReceipt) => {
  const file = path.join(key(receipt.workspaceId, receipt.tabId), 'receipt.json');
  const applied = { ...receipt, appliedAt: new Date().toISOString() };
  await fs.writeFile(`${file}.tmp`, JSON.stringify(applied), { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
  return applied;
};
export const readLaunchEvidence = async (workspaceId: string, tabId: string, sessionName: string) => {
  const dir = key(workspaceId, tabId);
  let receipt: ILaunchReceipt;
  try { receipt = JSON.parse(await fs.readFile(path.join(dir, 'receipt.json'), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  if (receipt.workspaceId !== workspaceId || receipt.tabId !== tabId || receipt.sessionName !== sessionName) throw new Error('Launch receipt identity mismatch');
  let startup = null;
  try { startup = JSON.parse(await fs.readFile(path.join(dir, 'startup.json'), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  return { receipt, startup }; // caller must correlate current session; missing/mismatched observation is NOT approval
};
