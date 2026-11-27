import {it,expect,vi} from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {randomUUID,createHash} from 'crypto';
const ownership=vi.hoisted(()=>({present:false,shell:true}));
vi.mock('@/lib/workspace-store',()=>({getWorkspaceById:vi.fn(async()=>ownership.present?{id:'ws-fixture'}:null)}));
vi.mock('@/lib/layout-store',()=>({getLayout:vi.fn(async()=>({root:{type:'leaf',id:'pane',tabs:ownership.shell?[{id:'tab-shell',sessionName:'shell',panelType:'terminal'}]:[]}})),addTabToPane:vi.fn()}));
vi.mock('@/lib/layout-tree',()=>({collectAllTabs:(x:{tabs:unknown[]})=>x.tabs,getFirstPaneId:()=> 'pane'}));
vi.mock('@/lib/runtime-tab-registration',()=>({registerExistingRuntimeTab:vi.fn()}));
vi.mock('@/lib/tmux',()=>({getSessionPanePid:vi.fn(async()=>process.pid)}));
import {type InitialLaunch,launchInitialCodex,readInitialLaunch} from '@/lib/codex-initial-launch';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const input=()=>{const operationId=randomUUID();return {operationId,workspaceId:'ws-fixture',tabId:'tab-relay-'+operationId,runId:randomUUID(),body:"literal $HOME `uname`\n--require-empty-codex 日本語",contractHash:hash('contract')};};
async function root(){return fs.mkdtemp(path.join(os.tmpdir(),'pmux-initial-'));}
async function receipt(x:InitialLaunch){const stat=await fs.readFile(`/proc/${process.pid}/stat`,'utf8');return {workspaceId:x.workspaceId,tabId:x.tabId,sessionName:'fixture-only',pid:process.pid,startTicks:stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]};}
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
it('real preparation rejects a missing workspace before runtime creation and records its stage',async()=>{
 const dir=await root(),x={...input(),workspaceId:'ws-missing-'+randomUUID(),owner:{shellTabId:'tab-shell',shellSessionName:'shell'}};
 try{
  await expect(launchInitialCodex(x,{root:dir})).rejects.toThrow('Initial launch failed');
  const saved=await readInitialLaunch(x.operationId,dir);
  expect(saved.state).toBe('failed-before-launch');expect(saved.receipt).toBeNull();
  expect(saved.stages.rejected).toEqual({stage:'ownership',errorCode:'OWNER_UNRESOLVED',modelStarted:false});
  expect(saved.stages['runtime-intent']).toBeUndefined();
  const start=vi.fn(async()=>receipt(x));await launchInitialCodex(x,{root:dir,start});expect(start).not.toHaveBeenCalled();
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


it('ownership rejection can continue after shell repair without skipping a live or unknown owner',async()=>{
 const dir=await root(),owner={shellTabId:'tab-shell',shellSessionName:'shell'},x={...input(),owner};
 ownership.present=true;ownership.shell=false;
 try{
  const start=vi.fn(async(y:InitialLaunch)=>receipt(y));
  await expect(launchInitialCodex(x,{root:dir,start})).rejects.toThrow();
  expect((await readInitialLaunch(x.operationId,dir)).state).toBe('failed-before-launch');
  ownership.shell=true;
  const y={...input(),owner:{...owner,previousOperationId:x.operationId}};
  expect((await launchInitialCodex(y,{root:dir,start})).state).toBe('started');expect(start).toHaveBeenCalledTimes(1);
  const z={...input(),owner:{...owner,previousOperationId:y.operationId}};
  await expect(launchInitialCodex(z,{root:dir,start})).rejects.toThrow();expect(start).toHaveBeenCalledTimes(1);
  const skip={...input(),owner:{...owner,previousOperationId:x.operationId}};
  await expect(launchInitialCodex(skip,{root:dir,start})).rejects.toThrow();expect(start).toHaveBeenCalledTimes(1);
 }finally{ownership.present=false;ownership.shell=true;await fs.rm(dir,{recursive:true,force:true});}
});
it('known contract rejection can replace its owner; unknown execution cannot',async()=>{
 const dir=await root(),owner={shellTabId:'tab-shell',shellSessionName:'shell'},x={...input(),owner};
 ownership.present=true;
 try{
  const reject=async(y:InitialLaunch)=>{await fs.writeFile(path.join(dir,y.operationId,'rejected.json'),JSON.stringify({stage:'contract'}));throw Error('contract');};
  await expect(launchInitialCodex(x,{root:dir,start:reject})).rejects.toThrow();
  const y={...input(),owner:{...owner,previousOperationId:x.operationId}};
  let calls=0;
  await expect(launchInitialCodex(y,{root:dir,start:async()=>{calls++;throw Error('unknown');}})).rejects.toThrow();
  expect(calls).toBe(1);
  const z={...input(),owner:{...owner,previousOperationId:y.operationId}},start=vi.fn(async()=>receipt(z));
  await expect(launchInitialCodex(z,{root:dir,start})).rejects.toThrow();expect(start).not.toHaveBeenCalled();
 }finally{ownership.present=false;await fs.rm(dir,{recursive:true,force:true});}
});
