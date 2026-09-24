export interface ITerminalPromptLine {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}

export interface ITerminalPromptBuffer {
  readonly length: number;
  getLine(y: number): ITerminalPromptLine | undefined;
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

interface ISyncPromptMarkersOptions {
  gutter: HTMLElement;
  buffer: ITerminalPromptBuffer;
  viewportY: number;
  viewportRows: number;
  screenTop: number;
  screenHeight: number;
  promptPrefix: string;
}

export const syncPromptMarkers = ({
  gutter,
  buffer,
  viewportY,
  viewportRows,
  screenTop,
  screenHeight,
  promptPrefix,
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
      marker = document.createElement('div');
      marker.className = 'terminal-prompt-marker';
      marker.dataset.bufferRow = String(row);
      gutter.appendChild(marker);
    }

    marker.style.top = `${screenTop + (row - viewportY) * rowHeight}px`;
    marker.style.height = `${rowHeight}px`;
  }
};
