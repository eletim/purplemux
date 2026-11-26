import {it,expect,vi} from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {randomUUID,createHash} from 'crypto';
vi.mock('@/lib/tmux',()=>({getSessionPanePid:vi.fn(async()=>process.pid)}));
import {launchInitialCodex,readInitialLaunch} from '@/lib/codex-initial-launch';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const input=()=>{const operationId=randomUUID();return {operationId,workspaceId:'ws-fixture',tabId:'tab-relay-'+operationId,runId:randomUUID(),body:"literal $HOME `uname`\n--require-empty-codex 日本語",contractHash:hash('contract')};};
async function root(){return fs.mkdtemp(path.join(os.tmpdir(),'pmux-initial-'));}
async function receipt(x:ReturnType<typeof input>){const stat=await fs.readFile(`/proc/${process.pid}/stat`,'utf8');return {workspaceId:x.workspaceId,tabId:x.tabId,sessionName:'fixture-only',pid:process.pid,startTicks:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};}
it('durable intent precedes creation, concurrent duplicate/query/restart never launches again',async()=>{
 const dir=await root(),x=input();let starts=0;
 try{
  const start=async()=>{starts++;const saved=await readInitialLaunch(x.operationId,dir);expect(saved.state).toBe('unknown');expect(saved.bodyHash).toBe(hash(x.body));return receipt(x);};
  await Promise.all([launchInitialCodex(x,{root:dir,start}),launchInitialCodex(x,{root:dir,start})]);
  const saved=await readInitialLaunch(x.operationId,dir);expect(saved.state).toBe('started');expect(saved.processMatches).toBe(true);
  await launchInitialCodex(x,{root:dir,start});expect(starts).toBe(1);
  await expect(launchInitialCodex({...x,body:'changed'},{root:dir,start})).rejects.toThrow('reused');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
it('launch failure and partially persisted intent remain unknown without replay',async()=>{
 const dir=await root(),x=input();let starts=0;const start=async()=>{starts++;throw Error('unknown');};
 try{
  await expect(launchInitialCodex(x,{root:dir,start})).rejects.toThrow('Initial launch failed');
  expect((await launchInitialCodex(x,{root:dir,start})).state).toBe('unknown');expect(starts).toBe(1);
  const y=input();await fs.mkdir(path.join(dir,y.operationId));expect((await launchInitialCodex(y,{root:dir,start})).state).toBe('unknown');expect(starts).toBe(1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
it('invalid slot/body and persistence failure cannot create any process',async()=>{
 const dir=await root(),x=input(),start=vi.fn(async()=>receipt(x));
 try{
  await expect(launchInitialCodex({...x,tabId:'existing-tab'},{root:dir,start})).rejects.toThrow();
  await expect(launchInitialCodex({...x,body:'あ'.repeat(30000)},{root:dir,start})).rejects.toThrow();
  const file=path.join(dir,'not-dir');await fs.writeFile(file,'x');await expect(launchInitialCodex(x,{root:file,start})).rejects.toThrow();expect(start).not.toHaveBeenCalled();
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
