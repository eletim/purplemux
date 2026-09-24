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

const normalizePromptCandidate = (text: string): string => text
  .replace(/^[\s\u200B\u200C\u200D\uFEFF]+/, '');

export const isShellPrompt = (text: string, promptPrefix: string): boolean =>
  promptPrefix.length > 0 && normalizePromptCandidate(text).startsWith(promptPrefix);

const findVisibleShellPromptRows = (
  buffer: ITerminalPromptBuffer,
  promptPrefix: string,
  viewportY: number,
  viewportRows: number,
): number[] => {
  const startRow = Math.max(0, viewportY);
  const endRow = Math.min(buffer.length, startRow + Math.max(0, viewportRows));
  const promptRows: number[] = [];

  for (let row = startRow; row < endRow; row++) {
    const line = buffer.getLine(row);
    if (!line || line.isWrapped) continue;
    if (isShellPrompt(line.translateToString(true), promptPrefix)) promptRows.push(row);
  }

  return promptRows;
};

export const snapshotPromptRows = (
  buffer: ITerminalPromptBuffer,
  startRow: number,
  endRow: number,
): ITerminalPromptRow[] => {
  const rows: ITerminalPromptRow[] = [];
  const snapshotEnd = Math.min(buffer.length, Math.max(0, endRow));

  for (let row = Math.max(0, startRow); row < snapshotEnd; row++) {
    const line = buffer.getLine(row);
    if (line) rows.push({ isWrapped: line.isWrapped, text: line.translateToString(false) });
  }

  return rows;
};

const readLogicalLines = (rows: readonly ITerminalPromptRow[]): string[] => {
  const logicalLines: string[] = [];

  rows.forEach((row, index) => {
    const continues = rows[index + 1]?.isWrapped === true;
    const text = continues ? row.text : row.text.trimEnd();
    if (row.isWrapped && logicalLines.length > 0) {
      logicalLines[logicalLines.length - 1] += text;
    } else {
      logicalLines.push(text);
    }
  });

  return logicalLines;
};

const promptBlockFromRows = (
  rows: readonly ITerminalPromptRow[],
  promptPrefix: string,
): { text: string | null; complete: boolean } => {
  const logicalLines = readLogicalLines(rows);
  if (logicalLines.length === 0 || !isShellPrompt(logicalLines[0], promptPrefix)) {
    return { text: null, complete: true };
  }

  const nextPrompt = logicalLines.findIndex((line, index) => (
    index > 0 && isShellPrompt(line, promptPrefix)
  ));
  const block = nextPrompt < 0 ? logicalLines : logicalLines.slice(0, nextPrompt);
  return {
    text: block.join('\n').replace(/\n+$/, ''),
    complete: nextPrompt >= 0,
  };
};

export const arePromptRowsEqual = (
  left: readonly ITerminalPromptRow[],
  right: readonly ITerminalPromptRow[],
): boolean => left.length === right.length && left.every((row, index) => (
  row.isWrapped === right[index].isWrapped && row.text === right[index].text
));

export const getNewlyVisiblePromptRows = (
  previous: readonly ITerminalPromptRow[],
  current: readonly ITerminalPromptRow[],
): ITerminalPromptRow[] => {
  const maxOverlap = Math.min(previous.length, current.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (arePromptRowsEqual(previous.slice(-overlap), current.slice(0, overlap))) {
      return current.slice(Math.max(overlap, current.length - 3));
    }
  }

  // One tmux wheel step exposes at most three rows. If a full redraw leaves no
  // comparable overlap, retain only those potentially new bottom rows.
  return current.slice(-3);
};

interface IRestorePromptViewportOptions {
  targetRows: readonly ITerminalPromptRow[];
  readRows: () => readonly ITerminalPromptRow[];
  scrollUp: () => Promise<void>;
  maxAttempts: number;
}

export const restorePromptViewport = async ({
  targetRows,
  readRows,
  scrollUp,
  maxAttempts,
}: IRestorePromptViewportOptions): Promise<boolean> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (arePromptRowsEqual(readRows(), targetRows)) return true;
    await scrollUp();
  }
  return arePromptRowsEqual(readRows(), targetRows);
};

interface ICollectPromptBlockOptions {
  initialRows: readonly ITerminalPromptRow[];
  promptPrefix: string;
  loadNextRows: () => Promise<readonly ITerminalPromptRow[] | null>;
}

export const collectPromptBlock = async ({
  initialRows,
  promptPrefix,
  loadNextRows,
}: ICollectPromptBlockOptions): Promise<string | null> => {
  const rows = [...initialRows];

  while (true) {
    const block = promptBlockFromRows(rows, promptPrefix);
    if (!block.text || block.complete) return block.text;

    const nextRows = await loadNextRows();
    if (!nextRows || nextRows.length === 0) return block.text;
    rows.push(...nextRows);
  }
};

interface ISyncPromptMarkersOptions {
  gutter: HTMLElement;
  buffer: ITerminalPromptBuffer;
  viewportY: number;
  viewportRows: number;
  screenTop: number;
  screenHeight: number;
  promptPrefix: string;
  label: string;
  onCopy: (promptRow: number) => void;
}

export const syncPromptMarkers = ({
  gutter,
  buffer,
  viewportY,
  viewportRows,
  screenTop,
  screenHeight,
  promptPrefix,
  label,
  onCopy,
}: ISyncPromptMarkersOptions): void => {
  const rowHeight = screenHeight / viewportRows;
  const promptRows = rowHeight > 0
    ? findVisibleShellPromptRows(buffer, promptPrefix, viewportY, viewportRows)
    : [];
  const visibleRows = new Set(promptRows);

  gutter.querySelectorAll<HTMLElement>('.terminal-prompt-marker').forEach((marker) => {
    const row = Number(marker.dataset.bufferRow);
    if (!visibleRows.has(row)) marker.remove();
  });

  for (const row of promptRows) {
    let marker = gutter.querySelector<HTMLElement>(`[data-buffer-row="${row}"]`);
    if (!marker) {
      marker = document.createElement('button');
      marker.setAttribute('type', 'button');
      marker.className = 'terminal-prompt-marker';
      marker.dataset.bufferRow = String(row);
      marker.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      marker.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onCopy(row);
      });
      gutter.appendChild(marker);
    }

    marker.setAttribute('aria-label', label);
    marker.title = label;
    marker.style.top = `${screenTop + (row - viewportY) * rowHeight}px`;
    marker.style.height = `${rowHeight}px`;
  }
};
