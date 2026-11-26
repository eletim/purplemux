import {it,expect,vi} from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {execFile} from 'child_process';
import {createServer} from 'http';
import {promisify} from 'util';
import {randomUUID,createHash} from 'crypto';
const state=vi.hoisted(()=>({root:'',socket:'',prompt:'',args:[] as string[],session:'',commands:[] as string[][]}));
vi.mock('@/lib/tmux-target',()=>({managedTmuxTarget:{kind:'managed'},execTmux:async(_t:unknown,args:string[],opts:unknown)=>{
 state.commands.push(args);return promisify(execFile)('tmux',['-L',state.socket,...args],opts as object);
},spawnTmux:vi.fn()}));
vi.mock('@/lib/pristine-env',()=>({PRISTINE_ENV:new Proxy({}, {get:(_t,k)=> k==='HOME'?state.root:k==='PATH'?process.env.PATH:k==='SHELL'?'/bin/bash':undefined,ownKeys:()=>['HOME','PATH','SHELL'],getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})})}));
vi.mock('@/lib/workspace-store',()=>({getWorkspaceById:async(id:string)=>({id,directories:[state.root]})}));
vi.mock('@/lib/providers/codex',()=>({buildCodexRuntimeArgs:async()=>state.args}));
vi.mock('@/lib/providers/codex/prompt',()=>({getCodexPromptPath:()=>state.prompt}));
vi.mock('@/lib/runtime-tab-registration',()=>({registerExistingRuntimeTab:async()=>true}));
vi.mock('@/lib/layout-store',()=>({getLayout:async()=>({root:{type:'pane',id:'pane-fixture',tabs:[]}}),addTabToPane:async(_w:string,_p:string,_n:string,cwd:string,_type:string,initial:{tabId:string;command:string})=>{
 const {createSession}=await import('@/lib/tmux');state.session='initial-fixture';await createSession(state.session,80,24,cwd,initial.command);return {id:initial.tabId,sessionName:state.session};
}}));
import {launchInitialCodex,readInitialLaunch} from '@/lib/codex-initial-launch';
it('real Codex initial argv through production clean shell and launcher records native input once',async()=>{
 state.root=await fs.mkdtemp(path.join(os.tmpdir(),'relay-real-initial-'));state.socket='relay-real-'+randomUUID();
 const server=createServer((req,res)=>{req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end('event: response.completed\ndata: '+JSON.stringify({type:'response.completed',response:{id:'fixture',object:'response',created_at:1,status:'completed',model:'probe',output:[],usage:{input_tokens:1,output_tokens:0,total_tokens:1}}})+'\n\n');});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  await fs.mkdir(path.join(state.root,'.codex'));
  await fs.writeFile(path.join(state.root,'.codex','config.toml'),'[projects.'+JSON.stringify(state.root)+']\ntrust_level = "trusted"\n');
  // If an rc file is read the launch fails; no reliance on nvm shell setup.
  await fs.writeFile(path.join(state.root,'.bash_profile'),'exit 91\n');
  const contract='<ai-village-instructions version="3">Isolated fixture only.</ai-village-instructions>';
  state.prompt=path.join(state.root,'prompt');await fs.writeFile(state.prompt,contract);
  const port=(server.address() as {port:number}).port;
  state.args=['--no-alt-screen','--dangerously-bypass-approvals-and-sandbox','-c','check_for_update_on_startup=false','-c','developer_instructions='+JSON.stringify(contract),'-c','model="probe"','-c','model_provider="probe"','-c','model_providers.probe.name="probe"','-c',`model_providers.probe.base_url="http://127.0.0.1:${port}/v1"`,'-c','model_providers.probe.wire_api="responses"','-c','model_providers.probe.requires_openai_auth=false','-c','model_providers.probe.request_max_retries=0','-c','model_providers.probe.stream_max_retries=0'];
  const operationId=randomUUID(),body="ISOLATED INITIAL literal 'quoted' $HOME `uname`\n--require-empty-codex 日本語";
  const x={operationId,workspaceId:'ws-fixture',tabId:'tab-relay-'+operationId,runId:randomUUID(),body,contractHash:createHash('sha256').update(contract).digest('hex')};
  const ledger=path.join(state.root,'ledger');const result=await launchInitialCodex(x,{root:ledger});expect(result.state).toBe('started');
  let records:{type:string;payload:{role?:string;type?:string;content?:{text?:string}[]}}[]=[];
  for(let i=0;i<80;i++){
   const files=await fs.readdir(path.join(state.root,'.codex','sessions'),{recursive:true}).catch(()=>[]);
   records=[];for(const f of files.filter(f=>String(f).endsWith('.jsonl')))records.push(...(await fs.readFile(path.join(state.root,'.codex','sessions',String(f)),'utf8')).trim().split('\n').map(l=>JSON.parse(l)));
   if(records.some(r=>r.type==='event_msg'&&r.payload.type==='task_complete'))break;
   await new Promise(r=>setTimeout(r,100));
  }
  expect(records.filter(r=>r.type==='response_item'&&r.payload.role==='user'&&(r.payload.content||[]).map(c=>c.text||'').join('')===body)).toHaveLength(1);
  expect(records.some(r=>r.type==='event_msg'&&r.payload.type==='task_complete')).toBe(true);
  const saved=await readInitialLaunch(operationId,ledger);expect(saved.processMatches).toBe(true);expect(saved.stages.preflight).toMatchObject({ok:true,version:'codex-cli 0.163.0'});expect(saved.stages.spawned).toBeTruthy();
  expect(state.commands.some(args=>args.includes('send-keys'))).toBe(false);
  await launchInitialCodex(x,{root:ledger});expect(state.commands.filter(a=>a.includes('new-session'))).toHaveLength(1);
  await fs.writeFile('/tmp/initial-env-real-result.json',JSON.stringify({root:state.root,operationId,inputCount:1,terminal:true,stages:saved.stages,processMatches:saved.processMatches,limit:'Real installed CLI/product launcher/clean shell/tmux; local fake model and fixture layout, not production recovery'},null,2));
 }finally{await promisify(execFile)('tmux',['-L',state.socket,'kill-server']).catch(()=>{});server.close();}
},20000);
