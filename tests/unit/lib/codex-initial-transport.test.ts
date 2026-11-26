import {it,expect,vi} from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {execFile} from 'child_process';
import {promisify} from 'util';
import {randomUUID,createHash} from 'crypto';
const state=vi.hoisted(()=>({root:'',socket:'',prompt:'',args:[] as string[],session:'',commands:[] as string[][]}));
vi.mock('@/lib/tmux-target',()=>({managedTmuxTarget:{kind:'managed'},execTmux:async(_t:unknown,args:string[],opts:unknown)=>{
 state.commands.push(args);return promisify(execFile)('tmux',['-L',state.socket,...args],opts as object);
},spawnTmux:vi.fn()}));
vi.mock('@/lib/shell-env',()=>({buildShellLaunchCommand:()=>`env PATH='${state.root}/bin:/usr/bin:/bin' RESULT='${state.root}/argv.json' /bin/bash --noprofile --norc`}));
vi.mock('@/lib/workspace-store',()=>({getWorkspaceById:async(id:string)=>({id,directories:[state.root]})}));
vi.mock('@/lib/providers/codex',()=>({buildCodexRuntimeArgs:async()=>state.args}));
vi.mock('@/lib/providers/codex/prompt',()=>({getCodexPromptPath:()=>state.prompt}));
vi.mock('@/lib/runtime-tab-registration',()=>({registerExistingRuntimeTab:async()=>true}));
vi.mock('@/lib/layout-store',()=>({getLayout:async()=>({root:{type:'pane',id:'pane-fixture',tabs:[]}}),addTabToPane:async(_w:string,_p:string,_n:string,cwd:string,_type:string,initial:{tabId:string;command:string})=>{
 const {createSession}=await import('@/lib/tmux');state.session='initial-fixture';await createSession(state.session,80,24,cwd,initial.command);return {id:initial.tabId,sessionName:state.session};
}}));
import {launchInitialCodex,readInitialLaunch} from '@/lib/codex-initial-launch';
it('production launch command starts argv directly, preserving literal body without any key send',async()=>{
 state.root=await fs.mkdtemp(path.join(os.tmpdir(),'relay-initial-transport-'));state.socket='relay-fixture-'+randomUUID();
 try{
  await fs.mkdir(path.join(state.root,'bin'));
  await fs.writeFile(path.join(state.root,'bin','codex'),'#!/usr/bin/python3\nimport os,sys,json,time\nopen(os.environ["RESULT"],"w").write(json.dumps(sys.argv[1:]))\ntime.sleep(30)\n',{mode:0o700});
  const contract='<ai-village-instructions version="3">fixture</ai-village-instructions>';
  state.prompt=path.join(state.root,'prompt');await fs.writeFile(state.prompt,'# purplemux context\n'+contract);
  state.args=['-c','developer_instructions='+JSON.stringify('# purplemux context\n'+contract)];
  const operationId=randomUUID(),body="literal 'quoted' $HOME `uname`\n--require-empty-codex 日本語";
  const x={operationId,workspaceId:'ws-fixture',tabId:'tab-relay-'+operationId,runId:randomUUID(),body,contractHash:createHash('sha256').update(contract).digest('hex')};
  const result=await launchInitialCodex(x,{root:path.join(state.root,'ledger')});expect(result.state).toBe('started');
  let argv:string[]=[];for(let i=0;i<30;i++){try{argv=JSON.parse(await fs.readFile(path.join(state.root,'argv.json'),'utf8'));break;}catch{await new Promise(r=>setTimeout(r,20));}}
  expect(argv).toEqual([...state.args,'--',body]);expect(state.commands.some(args=>args.includes('send-keys'))).toBe(false);
  expect((await readInitialLaunch(operationId,path.join(state.root,'ledger'))).processMatches).toBe(true);
  await launchInitialCodex(x,{root:path.join(state.root,'ledger')});expect(state.commands.filter(a=>a.includes('new-session'))).toHaveLength(1);
 }finally{await promisify(execFile)('tmux',['-L',state.socket,'kill-server']).catch(()=>{});await fs.rm(state.root,{recursive:true,force:true});}
});
