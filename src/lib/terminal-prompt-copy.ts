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

export const isShellPrompt = (text: string, promptPrefix: string): boolean =>
  promptPrefix.length > 0 && text.startsWith(promptPrefix);

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
  const logicalLines = readLogicalLines(buffer);
  const startIndex = logicalLines.findIndex(
    (line) => line.startRow === promptRow && isShellPrompt(line.text, promptPrefix),
  );
  if (startIndex < 0) return null;

  const nextPromptIndex = logicalLines.findIndex(
    (line, index) => index > startIndex && isShellPrompt(line.text, promptPrefix),
  );
  const endIndex = nextPromptIndex < 0 ? logicalLines.length : nextPromptIndex;

  return logicalLines
    .slice(startIndex, endIndex)
    .map((line) => line.text)
    .join('\n')
    .replace(/\n+$/, '');
};
