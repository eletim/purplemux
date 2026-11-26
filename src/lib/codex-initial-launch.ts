// A single fresh TUI launch, never a composer write or a retry of an unknown launch.
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { getWorkspaceById } from '@/lib/workspace-store';
import { getLayout, addTabToPane } from '@/lib/layout-store';
import { getFirstPaneId } from '@/lib/layout-tree';
import { buildCodexRuntimeArgs } from '@/lib/providers/codex';
import { getCodexPromptPath } from '@/lib/providers/codex/prompt';
import { registerExistingRuntimeTab } from '@/lib/runtime-tab-registration';
import { getSessionPanePid } from '@/lib/tmux';

export interface InitialLaunch {
  operationId: string; workspaceId: string; tabId: string; runId: string;
  body: string; contractHash: string;
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
  return { state: receipt ? 'started' : 'unknown', ...intent, receipt, processMatches };
}
const start = async (x: InitialLaunch) => {
  if(process.platform !== 'linux') throw Error('Initial launch requires Linux process identity');
  const ws = await getWorkspaceById(x.workspaceId); if (!ws) throw Error('Workspace missing');
  const contract = await fs.readFile(getCodexPromptPath(ws.id), 'utf8');
  const blocks = contract.match(/<ai-village-instructions version="[123]">[\s\S]*?<\/ai-village-instructions>/g) ?? [];
  if (blocks.length !== 1 || digest(blocks[0]) !== x.contractHash) throw Error('Startup contract changed');
  const args = await buildCodexRuntimeArgs(ws.id);
  // Bind the actual launch arguments, not just an earlier read of the prompt file.
  const index = args.findIndex(v => v.startsWith('developer_instructions='));
  if (index < 0 || args[index] !== `developer_instructions=${JSON.stringify(contract)}`) throw Error('Startup arguments changed');
  const paneId = getFirstPaneId((await getLayout(ws.id)).root);
  const command = ['exec', 'codex', ...args.map(quote), '--', quote(x.body)].join(' ');
  const tab = await addTabToPane(ws.id, paneId, 'Relay recovery', ws.directories[0], 'codex-cli', { tabId: x.tabId, command });
  if (!tab) throw Error('Pane missing');
  await registerExistingRuntimeTab(ws.id, tab.id);
  const pid = await getSessionPanePid(tab.sessionName); if (!pid) throw Error('Initial process not observed');
  // Linux scope is explicit. A missing identity never becomes a successful receipt.
  const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  return { workspaceId: ws.id, tabId: tab.id, sessionName: tab.sessionName, pid, startTicks };
};
export async function launchInitialCodex(x: InitialLaunch, options: { root?: string; start?: typeof start } = {}) {
  if (!x || Object.keys(x).sort().join(',') !== 'body,contractHash,operationId,runId,tabId,workspaceId'
    || !/^ws-[\w-]+$/.test(x.workspaceId) || x.tabId !== 'tab-relay-' + key(x.operationId)
    || !/^[a-f0-9-]{36}$/.test(x.runId) || !/^[a-f0-9]{64}$/.test(x.contractHash)
    || typeof x.body !== 'string' || !x.body.trim() || Buffer.byteLength(x.body) > 64000) throw Error('Invalid initial launch binding');
  const root = options.root ?? base(), dir = path.join(root, key(x.operationId));
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const intent = { operationId: x.operationId, workspaceId: x.workspaceId, tabId: x.tabId, runId: x.runId, bodyHash: digest(x.body), contractHash: x.contractHash };
  try { await fs.mkdir(dir, { mode: 0o700 }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const existing = await readInitialLaunch(x.operationId, root);
    for (const [k, v] of Object.entries(intent)) if (k in existing && existing[k as keyof typeof existing] !== v) throw Error('Initial launch operation reused');
    return existing; // Including incomplete intent: never execute it again.
  }
  await durable(path.join(dir, 'intent.json'), intent);
  for (const directory of [root,path.dirname(root)]) { const parent = await fs.open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); } }
  // All errors after this point remain unknown. In particular, no cleanup kills a possibly accepted TUI.
  const receipt = await (options.start ?? start)(x);
  await durable(path.join(dir, 'receipt.json'), receipt);
  return readInitialLaunch(x.operationId, root);
}
