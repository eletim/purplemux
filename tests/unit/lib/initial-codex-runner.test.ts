import {it,expect} from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {spawnSync} from 'child_process';
const runner=path.resolve('bin/initial-codex-runner.cjs');
async function fixture(executable:string,args:string[]=[]){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'initial-stage-'));await fs.writeFile(path.join(dir,'launch.json'),JSON.stringify({executable,prefix:[],args}),{mode:0o600});return dir;}
it('preflight failure records code and fingerprints without launching or leaking stderr',async()=>{
 const dir=await fixture('/definitely-absent-codex');
 try{expect(spawnSync(process.execPath,[runner,'probe',dir]).status).toBe(1);const p=JSON.parse(await fs.readFile(path.join(dir,'preflight.json'),'utf8'));expect(p.ok).toBe(false);expect(p.errorCode).toBe('ENOENT');await expect(fs.stat(path.join(dir,'spawn-intent.json'))).rejects.toThrow();}finally{await fs.rm(dir,{recursive:true,force:true});}
});
it('post-intent spawn failure stays distinct and cannot replay',async()=>{
 const dir=await fixture('/definitely-absent-codex');
 try{spawnSync(process.execPath,[runner,'run',dir]);expect(JSON.parse(await fs.readFile(path.join(dir,'spawn-error.json'),'utf8')).errorCode).toBe('ENOENT');const before=await fs.readFile(path.join(dir,'spawn-intent.json'),'utf8');expect(spawnSync(process.execPath,[runner,'run',dir]).status).toBe(1);expect(await fs.readFile(path.join(dir,'spawn-intent.json'),'utf8')).toBe(before);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
it('exit records status and stderr digest without persisting body or secret output',async()=>{
 const secret='private-output-fixture';const dir=await fixture(process.execPath,['-e',`process.stderr.write('${secret}');process.exitCode=17`]);
 try{expect(spawnSync(process.execPath,[runner,'run',dir]).status).toBe(17);const text=await fs.readFile(path.join(dir,'exit.json'),'utf8');const exit=JSON.parse(text);expect(exit.exitCode).toBe(17);expect(exit.stderr.bytes).toBe(secret.length);expect(text).not.toContain(secret);expect(exit.stderr.sha256).toMatch(/^[a-f0-9]{64}$/);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
