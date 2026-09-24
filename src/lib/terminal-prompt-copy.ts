export interface ITerminalPromptLine {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}

export interface ITerminalPromptBuffer {
  readonly length: number;
  getLine(y: number): ITerminalPromptLine | undefined;
}

export interface ITerminalPromptRow {
  readonly isWrapped: boolean;
  readonly text: string;
}

interface ILogicalBufferLine {
  startRow: number;
  endRow: number;
  text: string;
}

const PROMPT_COPY_CHUNK_ROWS = 40;

const normalizePromptCandidate = (text: string): string => text
  .replace(/^[\s\u200B\u200C\u200D\uFEFF]+/, '');

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

export const snapshotPromptRows = (
  buffer: ITerminalPromptBuffer,
  startRow = 0,
  endRow = buffer.length,
): ITerminalPromptRow[] => {
  const rows: ITerminalPromptRow[] = [];
  const snapshotEnd = Math.max(0, Math.min(endRow, buffer.length));
  for (let row = Math.max(0, startRow); row < snapshotEnd; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    rows.push({ isWrapped: line.isWrapped, text: line.translateToString(false) });
  }
  return rows;
};

const bufferFromRows = (rows: readonly ITerminalPromptRow[]): ITerminalPromptBuffer => ({
  length: rows.length,
  getLine: (row) => {
    const line = rows[row];
    if (!line) return undefined;
    return {
      isWrapped: line.isWrapped,
      translateToString: (trimRight = false) => trimRight ? line.text.trimEnd() : line.text,
    };
  },
});

const promptBlockFromRows = (
  rows: readonly ITerminalPromptRow[],
  promptPrefix: string,
): { text: string | null; hasNextPrompt: boolean } => {
  const logicalLines = readLogicalLines(bufferFromRows(rows));
  if (logicalLines.length === 0 || !isShellPrompt(logicalLines[0].text, promptPrefix)) {
    return { text: null, hasNextPrompt: false };
  }

  const nextPrompt = logicalLines.findIndex((line, index) => (
    index > 0 && isShellPrompt(line.text, promptPrefix)
  ));
  const blockLines = nextPrompt === -1 ? logicalLines : logicalLines.slice(0, nextPrompt);
  return {
    text: blockLines.map((line) => line.text).join('\n').replace(/\n+$/, ''),
    hasNextPrompt: nextPrompt !== -1,
  };
};

export const findNewPromptRows = (
  previous: readonly ITerminalPromptRow[],
  current: readonly ITerminalPromptRow[],
): ITerminalPromptRow[] => {
  const sameRow = (left: ITerminalPromptRow, right: ITerminalPromptRow) => (
    left.isWrapped === right.isWrapped && left.text === right.text
  );
  const maxOverlap = Math.min(previous.length, current.length);

  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const previousStart = previous.length - overlap;
    let matches = true;
    for (let row = 0; row < overlap; row++) {
      if (!sameRow(previous[previousStart + row], current[row])) {
        matches = false;
        break;
      }
    }
    if (matches) return current.slice(overlap);
  }

  return [...current];
};

interface ILoadNewPromptRowsAfterScrollOptions {
  readRows: () => readonly ITerminalPromptRow[];
  scroll: () => Promise<void>;
  waitForRetry: () => Promise<void>;
  retries: number;
}

export const loadNewPromptRowsAfterScroll = async ({
  readRows,
  scroll,
  waitForRetry,
  retries,
}: ILoadNewPromptRowsAfterScrollOptions): Promise<readonly ITerminalPromptRow[] | null> => {
  const previous = readRows();
  await scroll();

  for (let attempt = 0; attempt <= retries; attempt++) {
    const rows = readRows();
    const newRows = findNewPromptRows(previous, rows);
    if (newRows.length > 0) return newRows;
    if (attempt < retries) await waitForRetry();
  }

  return null;
};

interface IPromptBlockScrollOptions {
  loadMore: () => Promise<readonly ITerminalPromptRow[] | null>;
  restore: () => Promise<void>;
}

export const getPromptBlockTextWithScroll = async (
  buffer: ITerminalPromptBuffer,
  promptRow: number,
  promptPrefix: string,
  { loadMore, restore }: IPromptBlockScrollOptions,
): Promise<string | null> => {
  if (promptRow < 0 || promptRow >= buffer.length) return null;
  const rows = snapshotPromptRows(buffer, promptRow);

  try {
    while (true) {
      const block = promptBlockFromRows(rows, promptPrefix);
      if (!block.text || block.hasNextPrompt) return block.text;

      const more = await loadMore();
      if (!more || more.length === 0) return block.text;
      rows.push(...more);
    }
  } finally {
    await restore();
  }
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
