import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {test,expect} from 'vitest';
test.each([0,1])('CLI preserves server capability version %s without upgrading it',async(version)=>{
 const seen:unknown[]=[];const server=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;seen.push(text?JSON.parse(text):{});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.method==='GET'?{guardedCodexInput:{version}}:{status:'sent'}));});
 await new Promise<void>(r=>server.listen(0,r));const address=server.address();if(!address||typeof address==='string')throw Error('port');
 const env={...process.env,PMUX_PORT:String(address.port),PMUX_TOKEN:'fixture'};
 try{
  await promisify(execFile)(process.execPath,[resolve('bin/cli.js'),'tab','send','-w','ws-fixture','--require-empty-codex','tab-fixture','unchanged body'],{env});
  const cap=await promisify(execFile)(process.execPath,[resolve('bin/cli.js'),'tab','capabilities'],{env});
  expect(seen[0]).toEqual({content:'unchanged body',requireEmptyCodex:true});expect(JSON.parse(cap.stdout).guardedCodexInput).toEqual(version===1?{version,client:1}:{version});
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
