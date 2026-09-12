export interface ITerminalTextLine {
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}

export interface ITerminalTextBuffer {
  readonly length: number;
  getLine(y: number): ITerminalTextLine | undefined;
}

export interface ITerminalLineRange {
  start: number;
  end: number;
}

export const findLogicalLineStart = (buffer: ITerminalTextBuffer, line: number): number => {
  let start = Math.max(0, Math.min(line, buffer.length - 1));
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  return start;
};

export const looksLikeShellPrompt = (text: string): boolean =>
  /(?:^|\s)\S*[#$%>❯➜]\s*$/.test(text);

const SHELL_PROMPT_WITH_COMMAND_RE = /(?:^|\s)\S*[#$%>❯➜]\s+\S/;
const SHELL_PROMPT_MARKER_RE = /(?:^|\s)\S*[#$%>❯➜]\s/;

export const findShellCommandRange = (
  buffer: ITerminalTextBuffer,
  targetLine: number,
): ITerminalLineRange | null => {
  let candidate = -1;

  for (let y = Math.min(targetLine, buffer.length - 1); y >= 0; y--) {
    const line = buffer.getLine(y);
    if (!line || line.isWrapped) continue;
    if (SHELL_PROMPT_WITH_COMMAND_RE.test(line.translateToString(true))) {
      candidate = y;
      break;
    }
  }
  if (candidate < 0) return null;

  let end = buffer.length - 1;
  for (let y = candidate + 1; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line || line.isWrapped) continue;
    if (SHELL_PROMPT_MARKER_RE.test(line.translateToString(true))) {
      end = y - 1;
      break;
    }
  }

  return targetLine <= end ? { start: candidate, end } : null;
};

export const serializeTerminalRange = (
  buffer: ITerminalTextBuffer,
  start: number,
  end: number,
): string => {
  if (buffer.length === 0 || end < start) return '';

  const first = Math.max(0, start);
  const last = Math.min(end, buffer.length - 1);
  let text = '';

  for (let y = first; y <= last; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    if (text && !line.isWrapped) text += '\n';
    text += line.translateToString(true);
  }

  return text.replace(/\s+$/g, '');
};
