import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { parseLaunchProfile, prepareLaunchProfile, markLaunchApplied, readLaunchEvidence } from '@/lib/launch-profile';
import { HOOK_SETTINGS_PATH } from '@/lib/hook-settings';
const p = {version:1,provider:'claude',model:'claude-sonnet-5',effort:'high'};
describe('launch profile',()=>{
 it.each([null,{...p,version:2},{...p,provider:'codex'},{...p,extra:true},{...p,model:'sonnet'},{...p,model:'claude-opus-5;echo bad'},{...p,effort:'unknown'}])('rejects invalid profile %j',v=>expect(()=>parseLaunchProfile(v)).toThrow());
 it('persists separate argument and first startup evidence without changing shared settings',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'launch-profile-test-'));
  const home=vi.spyOn(os,'homedir').mockReturnValue(dir);
  const original=fs.readFile; const read=vi.spyOn(fs,'readFile');
  read.mockImplementation(async (...args: Parameters<typeof fs.readFile>)=>args[0]===HOOK_SETTINGS_PATH?JSON.stringify({hooks:{Stop:[{matcher:'',hooks:[]}]},permissions:{deny:['X']}}):original(...args));
  try{
   const identity={workspaceId:'ws-test',tabId:'tab-test',sessionName:'session-test'};
   const x=await prepareLaunchProfile(parseLaunchProfile(p),identity);
   expect((await readLaunchEvidence('ws-test','tab-test','session-test'))?.receipt.appliedAt).toBeNull();
   const settings=JSON.parse(await fs.readFile(x.settingsPath,'utf8'));
   expect(settings.permissions.deny).toEqual(['X']);expect(settings.hooks.Stop).toHaveLength(1);
   const hook=path.join(path.dirname(x.settingsPath),'observe.cjs');
   const run=(value:object)=>new Promise<void>((resolve,reject)=>{const child=execFile(process.execPath,[hook],e=>e?reject(e):resolve());child.stdin!.end(JSON.stringify(value));});
   await run({hook_event_name:'SessionStart',session_id:x.receipt.sessionId,model:p.model,source:'startup',secret:'never save'});
   await markLaunchApplied(x.receipt);
   const evidence=await readLaunchEvidence('ws-test','tab-test','session-test');expect(evidence?.startup.model).toBe(p.model);expect(JSON.stringify(evidence)).not.toContain('never save');expect(evidence?.receipt.appliedAt).toBeTruthy();
   await run({hook_event_name:'SessionStart',session_id:'different',model:'other'});
   expect((await readLaunchEvidence('ws-test','tab-test','session-test'))?.startup.sessionId).toBe(x.receipt.sessionId);
   await expect(readLaunchEvidence('ws-test','tab-test','other')).rejects.toThrow('identity');
   await expect(prepareLaunchProfile(parseLaunchProfile(p),identity)).rejects.toThrow();
  }finally{read.mockRestore();home.mockRestore();await fs.rm(dir,{recursive:true,force:true});}
 });
});
