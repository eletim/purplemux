// A single fresh TUI launch, never a composer write or a retry of an unknown launch.
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { PRISTINE_ENV } from '@/lib/pristine-env';
import { buildInitialShellLaunchCommand } from '@/lib/shell-env';
const execFile = promisify(execFileCb);
import { createHash } from 'crypto';
import { getWorkspaceById } from '@/lib/workspace-store';
import { getLayout, addTabToPane } from '@/lib/layout-store';
import { collectAllTabs, getFirstPaneId } from '@/lib/layout-tree';
import { buildCodexRuntimeArgs } from '@/lib/providers/codex';
import { getCodexPromptPath } from '@/lib/providers/codex/prompt';
import { registerExistingRuntimeTab } from '@/lib/runtime-tab-registration';
import { getSessionPanePid } from '@/lib/tmux';

export interface InitialLaunch {
  operationId: string; workspaceId: string; tabId: string; runId: string;
  body: string; contractHash: string;
  owner?: {shellTabId:string;shellSessionName:string;previousOperationId?:string};
}
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const base = () => path.join(os.homedir(), '.purplemux', 'initial-codex-launch');
const key = (id: string) => { if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid launch operation'); return id; };
async function durable(file: string, value: unknown) {
  const h = await fs.open(file, 'wx', 0o600);
  try { await h.writeFile(JSON.stringify(value)); await h.sync(); } finally { await h.close(); }
  const dir = await fs.open(path.dirname(file), 'r'); try { await dir.sync(); } finally { await dir.close(); }
}
export async function readInitialLaunch(operationId: string, root = base()) {
  const dir = path.join(root, key(operationId));
  let intent;
  try { intent = JSON.parse(await fs.readFile(path.join(dir, 'intent.json'), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return { state: 'unknown', operationId }; }
  let receipt = null;
  try { receipt = JSON.parse(await fs.readFile(path.join(dir, 'receipt.json'), 'utf8')); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  let processMatches = false;
  if (receipt) {
    try {
      const pid = await getSessionPanePid(receipt.sessionName);
      const stat = pid && await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      processMatches = pid === receipt.pid && !!stat && stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] === receipt.startTicks;
    } catch { /* observation only */ }
  }
  const stages: Record<string, unknown> = {};
  for (const name of ['rejected','owner-acquired','runtime-intent','preflight','spawn-intent','spawned','spawn-error','exit','launch-error']) {
    try { stages[name] = JSON.parse(await fs.readFile(path.join(dir, name + '.json'), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  const rejected = !receipt && !stages['runtime-intent'] && !stages['spawn-intent'] && (!!stages.rejected || (stages.preflight as {ok?:boolean})?.ok === false);
  return { state: rejected ? 'failed-before-launch' : receipt ? 'started' : 'unknown', ...intent, receipt, processMatches, stages };
}
async function executablePlan() {
  // Use the server's executable directory and captured startup PATH, not shell rc files.
  const node = await fs.realpath(process.execPath);
  const dirs = [...new Set([path.dirname(process.execPath), ...(PRISTINE_ENV.PATH || '').split(path.delimiter)])].filter(path.isAbsolute);
  for (const dir of dirs) {
    const candidate = path.join(dir, 'codex');
    try { await fs.access(candidate, fs.constants.X_OK); } catch { continue; }
    const codex = await fs.realpath(candidate), header = (await fs.readFile(codex)).subarray(0,256).toString();
    if (header.startsWith('#!') && /^#!\s*\/usr\/bin\/env\s+node(?:\r?\n|$)/.test(header))
      return {executable:node,prefix:[codex],path:[path.dirname(node),dir,'/usr/bin','/bin'].join(':')};
    if (header.startsWith('\x7fELF')) return {executable:codex,prefix:[] as string[],path:[path.dirname(node),dir,'/usr/bin','/bin'].join(':')};
    throw Error('Unsupported Codex executable interpreter');
  }
  throw Error('Codex executable not found in server startup PATH');
}
const start = async (x: InitialLaunch, dir: string) => {
  let stage='platform',runtimeMayExist=false;
  try {
  if(process.platform !== 'linux') throw Error('Initial launch requires Linux process identity');
  stage='workspace';
  const ws = await getWorkspaceById(x.workspaceId); if (!ws) throw Error('Workspace missing');
  stage='contract';
  const contract = await fs.readFile(getCodexPromptPath(ws.id), 'utf8');
  const blocks = contract.match(/<ai-village-instructions version="[123]">[\s\S]*?<\/ai-village-instructions>/g) ?? [];
  if (blocks.length !== 1 || digest(blocks[0]) !== x.contractHash) throw Error('Startup contract changed');
  stage='runtime-arguments';
  const args = await buildCodexRuntimeArgs(ws.id);
  // Bind the actual launch arguments, not just an earlier read of the prompt file.
  const index = args.findIndex(v => v.startsWith('developer_instructions='));
  if (index < 0 || args[index] !== `developer_instructions=${JSON.stringify(contract)}`) throw Error('Startup arguments changed');
  const paneId = getFirstPaneId((await getLayout(ws.id)).root);
  stage='executable';
  let plan;
  try { plan = await executablePlan(); }
  catch { await durable(path.join(dir,'preflight.json'),{stage:'resolve',ok:false,errorCode:'EXECUTABLE_UNRESOLVED'}); throw Error('Initial executable resolution failed'); }
  stage='runner';
  const runner = path.join(process.env.__PMUX_APP_DIR || process.cwd(),'bin','initial-codex-runner.cjs');
  await fs.access(runner, fs.constants.R_OK);
  await durable(path.join(dir,'launch.json'), {executable:plan.executable,prefix:plan.prefix,args:[...args,'--',x.body]});
  const invoke = (mode: string) => `export PATH=${quote(plan.path)}; exec ${quote(process.execPath)} ${quote(runner)} ${quote(mode)} ${quote(dir)}`;
  stage='preflight';
  try { await execFile('/bin/sh',['-c',buildInitialShellLaunchCommand(invoke('probe'))],{timeout:8000,maxBuffer:65536}); }
  catch { throw Error('Initial executable preflight failed; inspect launch stages'); }
  const command = invoke('run');
  // After this durable boundary any exception is uncertain, never prelaunch rejection.
  runtimeMayExist=true;
  await durable(path.join(dir,'runtime-intent.json'),{stage:'runtime-create'});
  const tab = await addTabToPane(ws.id, paneId, 'Village input', ws.directories[0], 'codex-cli', { tabId: x.tabId, command });
  if (!tab) throw Error('Pane missing');
  await registerExistingRuntimeTab(ws.id, tab.id);
  const pid = await getSessionPanePid(tab.sessionName); if (!pid) throw Error('Initial process not observed');
  // Linux scope is explicit. A missing identity never becomes a successful receipt.
  const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  return { workspaceId: ws.id, tabId: tab.id, sessionName: tab.sessionName, pid, startTicks };
  } catch(error) {
    if(!runtimeMayExist)await durable(path.join(dir,'rejected.json'),{stage,errorCode:'PRELAUNCH_REJECTED',modelStarted:false});
    throw error;
  }
};
// One launch owner per dedicated workspace. A lost lock is an unresolved intent,
// never a timeout lease. Existing operations remain query-only after a crash.
async function withInitialOwner<T>(x:InitialLaunch,root:string,start:()=>Promise<T>):Promise<T>{
 if(!x.owner)return start(); // Only the explicit isolated start adapter may omit ownership.
 if(!await getWorkspaceById(x.workspaceId))throw Error('Workspace missing');
 const slot=path.join(root,'workspaces',digest(x.workspaceId));await fs.mkdir(slot,{recursive:true,mode:0o700});
 const lock=await fs.open(path.join(slot,'lock'),'wx',0o600);
 try{
  let current:{operationId:string}|null=null;
  try{current=JSON.parse(await fs.readFile(path.join(slot,'current.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  // Follow only immutable, definitively unstarted predecessors. Ownership
  // acquisition itself may have failed, so not every rejected attempt is current.
  let previous=x.owner.previousOperationId;
  const visited=new Set<string>();
  while(previous){
   if(visited.has(previous))throw Error('Initial ownership cycle');
   visited.add(previous);
   const old=await readInitialLaunch(previous,root);
   if(old.workspaceId!==x.workspaceId||old.owner?.shellTabId!==x.owner.shellTabId||old.owner?.shellSessionName!==x.owner.shellSessionName||
      old.state!=='failed-before-launch'||old.receipt||old.stages?.['runtime-intent']||old.stages?.['spawn-intent'])throw Error('Previous managed execution is unresolved');
   if(current?.operationId===previous){current=null;break;}
   // An acquired-but-no-longer-current owner cannot be skipped.
   if(old.stages?.['owner-acquired'])throw Error('Initial workspace owner changed');
   previous=old.owner?.previousOperationId;
  }
  if(current)throw Error('Initial workspace owner changed');
  const tabs=collectAllTabs((await getLayout(x.workspaceId)).root),shell=tabs.find(t=>t.id===x.owner!.shellTabId);
  if(!shell||shell.sessionName!==x.owner.shellSessionName||tabs.some(t=>['codex-cli','claude-code'].includes(t.panelType||'')))throw Error('Workspace is not an owned unused input shell');
  const file=path.join(slot,x.operationId+'.json');await durable(file,{operationId:x.operationId,previousOperationId:x.owner.previousOperationId||null});
  const pointer=path.join(slot,'next.json');await durable(pointer,{operationId:x.operationId});
  await fs.rename(pointer,path.join(slot,'current.json'));
  const directory=await fs.open(slot,'r');try{await directory.sync();}finally{await directory.close();}
  await durable(path.join(root,x.operationId,'owner-acquired.json'),{workspaceId:x.workspaceId});
  return await start();
 }finally{await lock.close();await fs.unlink(path.join(slot,'lock'));}
}
export async function launchInitialCodex(x: InitialLaunch, options: { root?: string; start?: (x: InitialLaunch) => Promise<{workspaceId:string;tabId:string;sessionName:string;pid:number;startTicks:string}> } = {}) {
  if (!x || Object.keys(x).filter(k=>k!=='owner').sort().join(',') !== 'body,contractHash,operationId,runId,tabId,workspaceId'
    || !/^ws-[\w-]+$/.test(x.workspaceId) || x.tabId !== 'tab-relay-' + key(x.operationId)
    || !/^[a-f0-9-]{36}$/.test(x.runId) || !/^[a-f0-9]{64}$/.test(x.contractHash)
    || typeof x.body !== 'string' || !x.body.trim() || Buffer.byteLength(x.body) > 64000) throw Error('Invalid initial launch binding');
  if(x.owner&&(!x.owner.shellTabId||!x.owner.shellSessionName||Object.keys(x.owner).some(k=>!['shellTabId','shellSessionName','previousOperationId'].includes(k))))throw Error('Invalid initial owner');
  if(x.owner?.previousOperationId)key(x.owner.previousOperationId);
  const root = options.root ?? base(), dir = path.join(root, key(x.operationId));
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const intent = { operationId: x.operationId, workspaceId: x.workspaceId, tabId: x.tabId, runId: x.runId, bodyHash: digest(x.body), contractHash: x.contractHash,...(x.owner?{owner:x.owner}:{}) };
  try { await fs.mkdir(dir, { mode: 0o700 }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const existing = await readInitialLaunch(x.operationId, root);
    for (const [k, v] of Object.entries(intent)) if (k in existing && JSON.stringify(existing[k as keyof typeof existing]) !== JSON.stringify(v)) throw Error('Initial launch operation reused');
    return existing; // Including incomplete intent: never execute it again.
  }
  if(!x.owner&&!options.start)throw Error('New initial input requires workspace ownership');
  await durable(path.join(dir, 'intent.json'), intent);
  for (const directory of [root,path.dirname(root)]) { const parent = await fs.open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); } }
  // No error permits replay. Recorded preflight rejection is distinct from an uncertain launch; neither kills a possibly accepted TUI.
  let receipt,enteredStart=false;
  try {
    receipt = await withInitialOwner(x,root,()=>{enteredStart=true;return options.start ? options.start(x) : start(x,dir);});
    await durable(path.join(dir, 'receipt.json'), receipt);
  } catch {
    if(!enteredStart)await durable(path.join(dir,'rejected.json'),{stage:'ownership',errorCode:'OWNER_UNRESOLVED',modelStarted:false});
    await durable(path.join(dir,'launch-error.json'),{stage:'launch-error',errorCode:'INITIAL_LAUNCH_FAILED'});
    throw Error('Initial launch failed; inspect launch stages without retry');
  }
  return readInitialLaunch(x.operationId, root);
}
