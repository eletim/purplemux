import { readLayoutFile, resolveLayoutFile, collectAllTabs, ensureRegisteredTabSession } from '@/lib/layout-store';
import { getPaneCurrentCommand, getSessionPanePid, sendKeysSeparated } from '@/lib/tmux';
import { getWorkspaces } from '@/lib/workspace-store';
import { getProviderByPanelType, getProviderByProcessName } from '@/lib/providers';
import type { IAgentPreflight, IAgentProvider } from '@/lib/providers/types';
import { getStatusManager } from '@/lib/status-manager';
import { getChildPids, getProcessArgs } from '@/lib/process-utils';
import { createLogger } from '@/lib/logger';

const log = createLogger('auto-resume');

const SHELL_READY_DELAY_MS = 500;
const SAFE_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash']);

interface IAutoResumeTarget {
  workspaceId: string;
  tabId: string;
  tmuxSession: string;
  sessionId: string;
  provider: IAgentProvider;
}

const findAutoResumeTargets = async (): Promise<IAutoResumeTarget[]> => {
  const { workspaces } = await getWorkspaces();
  const targets: IAutoResumeTarget[] = [];
  const preflightByProvider = new Map<string, IAgentPreflight>();

  const getProviderPreflight = async (provider: IAgentProvider): Promise<IAgentPreflight> => {
    const cached = preflightByProvider.get(provider.id);
    if (cached) return cached;
    const status = await provider.preflight();
    preflightByProvider.set(provider.id, status);
    return status;
  };

  for (const ws of workspaces) {
    const layout = await readLayoutFile(resolveLayoutFile(ws.id));
    if (!layout) continue;

    const tabs = collectAllTabs(layout.root);
    for (const tab of tabs) {
      const provider = getProviderByPanelType(tab.panelType);
      if (!provider) continue;
      const preflight = await getProviderPreflight(provider);
      if (!preflight.installed) {
        const reason = provider.id === 'claude' && preflight.binaryPath ? 'PATH not configured' : 'not installed';
        log.info(`Skip resume for ${provider.id} tab ${tab.id}: ${reason}`);
        continue;
      }
      const sessionId = provider.readSessionId(tab);
      if (!sessionId) continue;
      targets.push({
        workspaceId: ws.id,
        tabId: tab.id,
        tmuxSession: tab.sessionName,
        sessionId,
        provider,
      });
    }
  }

  return targets;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const fetchForegroundArgs = async (tmuxSession: string): Promise<string[] | undefined> => {
  const panePid = await getSessionPanePid(tmuxSession);
  if (!panePid) return undefined;
  const childPids = await getChildPids(panePid);
  for (const cpid of childPids) {
    const argsStr = await getProcessArgs(cpid);
    if (argsStr) return argsStr.split(/\s+/);
  }
  return undefined;
};

const sendResumeKeys = async (target: IAutoResumeTarget): Promise<boolean> => {
  try {
    const command = await getPaneCurrentCommand(target.tmuxSession);
    if (!command) {
      log.warn(`Cannot check process: ${target.tmuxSession}`);
      return false;
    }

    if (!SAFE_SHELLS.has(command)) {
      const args = command === 'node' ? await fetchForegroundArgs(target.tmuxSession) : undefined;
      const runningProvider = getProviderByProcessName(command, args);
      if (runningProvider && runningProvider.id === target.provider.id) {
        log.debug(`${target.provider.displayName} already running, skip: ${target.tmuxSession}`);
        return true;
      }
      log.debug(`Non-shell process running (${command}), skip: ${target.tmuxSession}`);
      return false;
    }

    const resumeCmd = await target.provider.buildResumeCommand(target.sessionId, {
      workspaceId: target.workspaceId,
    });
    log.debug(`Sending resume: ${target.tmuxSession} → ${target.sessionId}`);
    await sendKeysSeparated(target.tmuxSession, resumeCmd);
    getStatusManager().markAgentLaunch(target.tabId);

    return true;
  } catch (err) {
    log.error(`Failed: ${target.tmuxSession} — ${err instanceof Error ? err.message : err}`);
    return false;
  }
};

export const executeAutoResume = async (targets: IAutoResumeTarget[]): Promise<void> => {
  // Phase 1: Sequential session creation — first createSession cold-starts tmux server, so avoid race
  let hasNewSession = false;
  const resumableTargets: IAutoResumeTarget[] = [];
  for (const target of targets) {
    const result = await ensureRegisteredTabSession(
      target.workspaceId,
      target.tabId,
      target.tmuxSession,
    );
    if (result === 'missing') {
      log.debug(`Skip stale auto-resume target: ${target.tmuxSession}`);
      continue;
    }
    resumableTargets.push(target);
    if (result === 'created') {
      log.debug(`No tmux session, creating new: ${target.tmuxSession}`);
      hasNewSession = true;
    }
  }

  // Phase 2: Wait for shell initialization if new sessions were created (once)
  if (hasNewSession) {
    await sleep(SHELL_READY_DELAY_MS);
  }

  // Phase 3: Send resume commands in parallel
  await Promise.allSettled(resumableTargets.map((target) => sendResumeKeys(target)));
};

export const autoResumeOnStartup = async (): Promise<void> => {
  const targets = await findAutoResumeTargets();
  if (targets.length === 0) return;

  log.debug(`${targets.length} surface(s) auto-resume started`);
  executeAutoResume(targets).then(() => {
    log.debug('Auto-resume complete');
  }).catch((err) => {
    log.error(`Auto-resume error: ${err instanceof Error ? err.message : err}`);
  });
};
