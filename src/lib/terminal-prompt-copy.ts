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
  occurrenceFromEnd: number;
}

const PROMPT_COPY_CHUNK_ROWS = 40;

const normalizePromptCandidate = (text: string): string => text
  .replace(/^[\s\u200B\u200C\u200D\uFEFF]+/, '');

const normalizePromptIdentity = (text: string): string =>
  normalizePromptCandidate(text).trimEnd();

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

export const getPromptBlockText = (
  buffer: ITerminalPromptBuffer,
  promptRow: number,
  promptPrefix: string,
): string | null => {
  const snapshotEnd = buffer.length;
  if (promptRow < 0 || promptRow >= snapshotEnd) return null;

  const snapshotBuffer: ITerminalPromptBuffer = {
    length: snapshotEnd,
    getLine: (row) => row < snapshotEnd ? buffer.getLine(row) : undefined,
  };
  const copiedLines: string[] = [];
  let nextRow = promptRow;

  while (nextRow < snapshotEnd) {
    const chunk = readLogicalLines(
      snapshotBuffer,
      nextRow,
      Math.min(nextRow + PROMPT_COPY_CHUNK_ROWS, snapshotEnd),
    );
    if (chunk.length === 0) break;

    for (const line of chunk) {
      if (copiedLines.length === 0) {
        if (line.startRow !== promptRow || !isShellPrompt(line.text, promptPrefix)) return null;
      } else if (isShellPrompt(line.text, promptPrefix)) {
        return copiedLines.join('\n').replace(/\n+$/, '');
      }
      copiedLines.push(line.text);
    }

    nextRow = chunk[chunk.length - 1].endRow + 1;
  }

  return copiedLines.length > 0 ? copiedLines.join('\n').replace(/\n+$/, '') : null;
};

export const getPromptSnapshotIdentity = (
  buffer: ITerminalPromptBuffer,
  promptRow: number,
  promptPrefix: string,
): IPromptSnapshotIdentity | null => {
  const logicalLines = readLogicalLines(buffer, promptRow);
  const prompt = logicalLines.find((line) => line.startRow === promptRow);
  if (!prompt || !isShellPrompt(prompt.text, promptPrefix)) return null;

  const text = normalizePromptIdentity(prompt.text);
  const occurrenceFromEnd = logicalLines.filter(
    (line) => isShellPrompt(line.text, promptPrefix)
      && normalizePromptIdentity(line.text) === text,
  ).length;

  return occurrenceFromEnd > 0 ? { text, occurrenceFromEnd } : null;
};

export const getPromptBlockFromSnapshot = (
  snapshot: string,
  identity: IPromptSnapshotIdentity,
  promptPrefix: string,
): string | null => {
  if (!Number.isInteger(identity.occurrenceFromEnd) || identity.occurrenceFromEnd < 1) return null;

  const lines = snapshot.replace(/\r\n/g, '\n').split('\n');
  const matchingRows = lines.reduce<number[]>((rows, line, row) => {
    if (isShellPrompt(line, promptPrefix)
      && normalizePromptIdentity(line) === normalizePromptIdentity(identity.text)) {
      rows.push(row);
    }
    return rows;
  }, []);
  const promptRow = matchingRows[matchingRows.length - identity.occurrenceFromEnd];
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
