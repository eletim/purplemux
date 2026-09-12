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

const HOST_PATH_PROMPT_RE = /^(?:\([^)]+\)\s*)?[\w.-]+@[\w.-]+:(?:~|\/).*?[#$%>❯➜](?:\s|$)/;
const PATH_PROMPT_RE = /^(?:~|\/)[^\r\n]*?[#$%>❯➜](?:\s|$)/;
const SIMPLE_PROMPT_RE = /^[$%❯➜](?:\s|$)/;

export const isShellPrompt = (text: string): boolean => (
  HOST_PATH_PROMPT_RE.test(text)
  || PATH_PROMPT_RE.test(text)
  || SIMPLE_PROMPT_RE.test(text)
);

const findLogicalLineStart = (buffer: ITerminalPromptBuffer, row: number): number => {
  let startRow = Math.max(0, Math.min(row, buffer.length - 1));
  while (startRow > 0 && buffer.getLine(startRow)?.isWrapped) startRow--;
  return startRow;
};

const readLogicalLines = (
  buffer: ITerminalPromptBuffer,
  startRow = 0,
): ILogicalBufferLine[] => {
  const logicalLines: ILogicalBufferLine[] = [];

  for (let row = findLogicalLineStart(buffer, startRow); row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
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
  startRow = 0,
): number[] => (
  readLogicalLines(buffer, startRow)
    .filter((line) => isShellPrompt(line.text))
    .map((line) => line.startRow)
);

export const getPromptBlockText = (
  buffer: ITerminalPromptBuffer,
  promptRow: number,
): string | null => {
  const logicalLines = readLogicalLines(buffer);
  const startIndex = logicalLines.findIndex(
    (line) => line.startRow === promptRow && isShellPrompt(line.text),
  );
  if (startIndex < 0) return null;

  const nextPromptIndex = logicalLines.findIndex(
    (line, index) => index > startIndex && isShellPrompt(line.text),
  );
  const endIndex = nextPromptIndex < 0 ? logicalLines.length : nextPromptIndex;

  return logicalLines
    .slice(startIndex, endIndex)
    .map((line) => line.text)
    .join('\n')
    .replace(/\n+$/, '');
};
