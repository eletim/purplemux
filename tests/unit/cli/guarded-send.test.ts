import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {test,expect} from 'vitest';
test('CLI sends guard as a separate API field and advertises both endpoint and CLI support',async()=>{
 const seen:unknown[]=[];const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;seen.push(text?JSON.parse(text):{});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.method==='GET'?{guardedCodexInput:{version:1}}:{status:'sent'}));});
 await new Promise<void>(r=>server.listen(0,r));const address=server.address();if(!address||typeof address==='string')throw Error('port');
 const env={...process.env,PMUX_PORT:String(address.port),PMUX_TOKEN:'fixture'};
 try{
  await promisify(execFile)(process.execPath,[resolve('bin/cli.js'),'tab','send','-w','ws-fixture','--require-empty-codex','tab-fixture','unchanged body'],{env});
  const cap=await promisify(execFile)(process.execPath,[resolve('bin/cli.js'),'tab','capabilities'],{env});
  expect(seen[0]).toEqual({content:'unchanged body',requireEmptyCodex:true});expect(JSON.parse(cap.stdout).guardedCodexInput).toEqual({version:1,client:1});
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
