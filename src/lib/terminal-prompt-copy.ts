export interface ITerminalPromptLine {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}

export interface ITerminalPromptBuffer {
  readonly length: number;
  getLine(y: number): ITerminalPromptLine | undefined;
}

interface ILogicalBufferLine {
  startRow: number;
  endRow: number;
  text: string;
}

export interface IPromptSnapshotIdentity {
  text: string;
  before: string[];
  after: string[];
  clickEnd: string[];
  matchingOccurrenceFromEnd: number;
  nextPrompt: string | null;
}

const PROMPT_IDENTITY_CONTEXT_LINES = 8;
const CLICK_END_CONTEXT_LINES = 8;

const normalizePromptCandidate = (text: string): string => text
  .replace(/^[\s\u200B\u200C\u200D\uFEFF]+/, '');

const normalizePromptIdentity = (text: string): string =>
  normalizePromptCandidate(text).trimEnd();

const normalizeContextLine = (text: string): string => text.trimEnd();

export const isShellPrompt = (text: string, promptPrefix: string): boolean =>
  promptPrefix.length > 0 && normalizePromptCandidate(text).startsWith(promptPrefix);

const findLogicalLineStart = (buffer: ITerminalPromptBuffer, row: number): number => {
  let startRow = Math.max(0, Math.min(row, buffer.length - 1));
  while (startRow > 0 && buffer.getLine(startRow)?.isWrapped) startRow--;
  return startRow;
};

const readLogicalLines = (
  buffer: ITerminalPromptBuffer,
  startRow = 0,
  endRow = buffer.length,
): ILogicalBufferLine[] => {
  const logicalLines: ILogicalBufferLine[] = [];
  const scanEnd = Math.max(0, Math.min(endRow, buffer.length));

  for (let row = findLogicalLineStart(buffer, startRow); row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    if (row >= scanEnd && !line.isWrapped) break;
    const continuesOnNextRow = buffer.getLine(row + 1)?.isWrapped === true;
    const text = line.translateToString(!continuesOnNextRow);

    if (line.isWrapped && logicalLines.length > 0) {
      const current = logicalLines[logicalLines.length - 1];
      current.endRow = row;
      current.text += text;
      continue;
    }

    logicalLines.push({
      startRow: row,
      endRow: row,
      text,
    });
  }

  return logicalLines;
};

export const findShellPromptRows = (
  buffer: ITerminalPromptBuffer,
  promptPrefix: string,
  startRow = 0,
  endRow = buffer.length,
): number[] => (
  readLogicalLines(buffer, startRow, endRow)
    .filter((line) => isShellPrompt(line.text, promptPrefix))
    .map((line) => line.startRow)
);

interface ISyncPromptCopyButtonsOptions {
  gutter: HTMLElement;
  buffer: ITerminalPromptBuffer;
  viewportY: number;
  viewportRows: number;
  screenTop: number;
  screenHeight: number;
  label: string;
  onCopy: (promptRow: number) => void;
  promptPrefix: string;
}

export const syncPromptCopyButtons = ({
  gutter,
  buffer,
  viewportY,
  viewportRows,
  screenTop,
  screenHeight,
  label,
  onCopy,
  promptPrefix,
}: ISyncPromptCopyButtonsOptions): void => {
  const rowHeight = screenHeight / viewportRows;
  const viewportEnd = viewportY + viewportRows;
  const promptRows = rowHeight > 0
    ? findShellPromptRows(buffer, promptPrefix, viewportY, viewportEnd)
      .filter((row) => row >= viewportY && row < viewportEnd)
    : [];
  const visibleRows = new Set(promptRows);

  gutter.querySelectorAll<HTMLButtonElement>('.terminal-prompt-copy-button').forEach((button) => {
    const row = Number(button.dataset.bufferRow);
    if (!visibleRows.has(row)) button.remove();
  });

  for (const row of promptRows) {
    let button = gutter.querySelector<HTMLButtonElement>(`[data-buffer-row="${row}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'terminal-prompt-copy-button';
      button.dataset.bufferRow = String(row);
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onCopy(row);
      });
      gutter.appendChild(button);
    }

    button.setAttribute('aria-label', label);
    button.title = label;
    button.style.top = `${screenTop + (row - viewportY) * rowHeight}px`;
    button.style.height = `${rowHeight}px`;
  }
};

export const getPromptSnapshotIdentity = (
  buffer: ITerminalPromptBuffer,
  promptRow: number,
  promptPrefix: string,
): IPromptSnapshotIdentity | null => {
  const snapshotEnd = buffer.length;
  if (promptRow < 0 || promptRow >= snapshotEnd) return null;
  const snapshotBuffer: ITerminalPromptBuffer = {
    length: snapshotEnd,
    getLine: (row) => row < snapshotEnd ? buffer.getLine(row) : undefined,
  };
  const logicalLines = readLogicalLines(snapshotBuffer);
  const promptIndex = logicalLines.findIndex((line) => line.startRow === promptRow);
  const prompt = logicalLines[promptIndex];
  if (!prompt || !isShellPrompt(prompt.text, promptPrefix)) return null;

  const nonBlankEnd = logicalLines.findLastIndex((line) => normalizeContextLine(line.text).length > 0);
  if (nonBlankEnd < promptIndex) return null;
  const nextPrompt = logicalLines
    .slice(promptIndex + 1)
    .find((line) => isShellPrompt(line.text, promptPrefix));

  const identity = {
    text: normalizePromptIdentity(prompt.text),
    before: logicalLines
      .slice(Math.max(0, promptIndex - PROMPT_IDENTITY_CONTEXT_LINES), promptIndex)
      .map((line) => normalizeContextLine(line.text)),
    after: logicalLines
      .slice(promptIndex + 1, Math.min(
        promptIndex + 1 + PROMPT_IDENTITY_CONTEXT_LINES,
        nonBlankEnd + 1,
      ))
      .map((line) => normalizeContextLine(line.text)),
    clickEnd: logicalLines
      .slice(Math.max(0, nonBlankEnd - CLICK_END_CONTEXT_LINES + 1), nonBlankEnd + 1)
      .map((line) => normalizeContextLine(line.text)),
    nextPrompt: nextPrompt ? normalizePromptIdentity(nextPrompt.text) : null,
  };
  const matchingRows = findPromptIdentityMatches(
    logicalLines.map((line) => normalizeContextLine(line.text)),
    identity,
    promptPrefix,
  );
  const matchingIndex = matchingRows.indexOf(promptIndex);
  if (matchingIndex < 0) return null;

  return {
    ...identity,
    matchingOccurrenceFromEnd: matchingRows.length - matchingIndex,
  };
};

const contextMatches = (
  lines: string[],
  startRow: number,
  context: string[],
  allowLastLineGrowth = false,
): boolean => context.every((expected, offset) => {
  const actual = normalizeContextLine(lines[startRow + offset] ?? '');
  return allowLastLineGrowth && offset === context.length - 1
    ? actual.startsWith(expected)
    : actual === expected;
});

const findPromptIdentityMatches = (
  lines: string[],
  identity: Pick<IPromptSnapshotIdentity, 'text' | 'before' | 'after' | 'nextPrompt'>,
  promptPrefix: string,
): number[] => lines.reduce<number[]>((rows, line, row) => {
  if (isShellPrompt(line, promptPrefix)
    && normalizePromptIdentity(line) === normalizePromptIdentity(identity.text)
    && contextMatches(lines, row - identity.before.length, identity.before)
    && contextMatches(lines, row + 1, identity.after, identity.nextPrompt === null)) {
    rows.push(row);
  }
  return rows;
}, []);

const findContextEnds = (
  lines: string[],
  context: string[],
  allowLastLineGrowth: boolean,
): number[] => {
  if (context.length === 0) return [];
  const ends: number[] = [];
  for (let row = 0; row <= lines.length - context.length; row++) {
    if (contextMatches(lines, row, context, allowLastLineGrowth)) {
      ends.push(row + context.length);
    }
  }
  return ends;
};

export const getPromptBlockFromSnapshot = (
  snapshot: string,
  identity: IPromptSnapshotIdentity,
  promptPrefix: string,
): string | null => {
  const lines = snapshot.replace(/\r\n/g, '\n').split('\n').map(normalizeContextLine);

  const matchingRows = findPromptIdentityMatches(lines, identity, promptPrefix);
  let promptRow = matchingRows.length === 1 && identity.matchingOccurrenceFromEnd === 1
    ? matchingRows[0]
    : undefined;

  if (promptRow === undefined && matchingRows.length > 0) {
    const candidates = new Set<number>();
    for (const clickEnd of findContextEnds(
      lines,
      identity.clickEnd,
      identity.nextPrompt === null,
    )) {
      const matchesBeforeClickEnd = matchingRows.filter((row) => row < clickEnd);
      const candidate = matchesBeforeClickEnd[
        matchesBeforeClickEnd.length - identity.matchingOccurrenceFromEnd
      ];
      if (candidate !== undefined) candidates.add(candidate);
    }
    if (candidates.size === 1) [promptRow] = candidates;
  }

  if (promptRow === undefined) return null;

  let endRow = lines.length;
  for (let row = promptRow + 1; row < lines.length; row++) {
    if (isShellPrompt(lines[row], promptPrefix)) {
      endRow = row;
      break;
    }
  }
  return lines.slice(promptRow, endRow).join('\n').replace(/\n+$/, '');
};
