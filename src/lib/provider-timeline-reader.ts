import path from 'path';
import { existsSync } from 'fs';
import type { IChunkReadResult, ITimelineEntry } from '@/types/timeline';
import type { IAgentProvider } from '@/lib/providers/types';
import { CODEX_PROVIDER_ID } from '@/lib/providers/codex';
import { findCodexSessionById } from '@/lib/providers/codex/session-detection';
import {
  readCodexEntriesBefore,
  readTailCodexEntries,
  type CodexParser,
} from '@/lib/session-parser-codex';
import { readEntriesBefore, readTailEntries } from '@/lib/session-parser';
import { getSessionCwd } from '@/lib/tmux';
import { cwdToProjectPath } from '@/lib/session-list';
import { isCodexJsonlPath } from '@/lib/path-validation';

export const readProviderTimelineTail = async (
  provider: IAgentProvider,
  jsonlPath: string,
  maxEntries: number,
  codexParser?: CodexParser | null,
): Promise<IChunkReadResult> => {
  if (provider.id === CODEX_PROVIDER_ID || isCodexJsonlPath(jsonlPath)) {
    return codexParser
      ? codexParser.parseTail(maxEntries)
      : readTailCodexEntries(jsonlPath, maxEntries);
  }
  return readTailEntries(jsonlPath, maxEntries);
};

export const readProviderTimelineUntil = async (
  provider: IAgentProvider,
  jsonlPath: string,
  pageSize: number,
  predicate: (entries: ITimelineEntry[]) => boolean,
): Promise<ITimelineEntry[]> => {
  const isCodex = provider.id === CODEX_PROVIDER_ID || isCodexJsonlPath(jsonlPath);
  let page = await readProviderTimelineTail(provider, jsonlPath, pageSize);
  let entries = page.entries;

  while (page.hasMore && !predicate(entries)) {
    const previousStart = page.startByteOffset;
    const previous = isCodex
      ? await readCodexEntriesBefore(jsonlPath, previousStart, pageSize)
      : await readEntriesBefore(jsonlPath, previousStart, pageSize);
    if (previous.startByteOffset >= previousStart) break;

    entries = isCodex ? previous.entries : [...previous.entries, ...entries];
    page = previous;
  }

  return entries;
};

export const resolveProviderJsonlPath = async (
  provider: IAgentProvider,
  tmuxSession: string,
  sessionId: string,
): Promise<string | null> => {
  if (provider.id === CODEX_PROVIDER_ID) {
    return (await findCodexSessionById(sessionId))?.jsonlPath ?? null;
  }

  const cwd = await getSessionCwd(tmuxSession);
  if (!cwd) return null;
  const jsonlPath = path.join(cwdToProjectPath(cwd), `${sessionId}.jsonl`);
  return existsSync(jsonlPath) ? jsonlPath : null;
};
