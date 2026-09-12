export interface ITerminalTextLine {
  readonly isWrapped: boolean;
  readonly length: number;
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

export interface ITerminalTextBuffer {
  readonly length: number;
  getLine(y: number): ITerminalTextLine | undefined;
}

export interface ITerminalPosition {
  line: number;
  column: number;
}

export interface ITerminalTextRange {
  start: ITerminalPosition;
  end: ITerminalPosition;
}

export interface IPromptBoundary extends ITerminalTextRange {
  tail: string;
}

const SIMPLE_PROMPT_RE = /^([#$%❯➜]\s)$/;
const SIMPLE_PROMPT_WITH_COMMAND_RE = /^([#$%❯➜]\s)\S/;
const HOST_PATH_PROMPT_SUFFIX_RE = /([\w.-]+@[\w.-]+:(?:~|\/).*?[#$%>]\s)$/;
const HOST_PATH_PROMPT_WITH_COMMAND_RE = /^([\w.-]+@[\w.-]+:(?:~|\/).*?[#$%>]\s)\S/;
const PATH_PROMPT_SUFFIX_RE = /((?:~|\/).*?[#$%>]\s)$/;
const PATH_PROMPT_WITH_COMMAND_RE = /^((?:~|\/).*?[#$%>]\s)\S/;
const HOST_PERCENT_PROMPT_SUFFIX_RE = /([\w.-]+%\s)$/;
const HOST_PERCENT_PROMPT_WITH_COMMAND_RE = /^([\w.-]+%\s)\S/;
const PATH_ONLY_LINE_RE = /^([\w.-]+@[\w.-]+:(?:~|\/).*|(?:~|\/).*)$/;

export const findLogicalLineStart = (buffer: ITerminalTextBuffer, line: number): number => {
  let start = Math.max(0, Math.min(line, buffer.length - 1));
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  return start;
};

const lineTextToColumn = (
  buffer: ITerminalTextBuffer,
  line: number,
  column: number,
): string => buffer.getLine(line)?.translateToString(false).slice(0, column) ?? '';

const matchPromptSuffix = (text: string, knownTail?: string): { index: number; tail: string } | null => {
  if (knownTail && text.endsWith(knownTail)) {
    return { index: text.length - knownTail.length, tail: knownTail };
  }
  const knownHost = knownTail?.match(/^([\w.-]+@[\w.-]+:)/)?.[1];
  const knownHostIndex = knownHost ? text.lastIndexOf(knownHost) : -1;
  if (knownHostIndex >= 0) {
    const match = HOST_PATH_PROMPT_SUFFIX_RE.exec(text.slice(knownHostIndex));
    if (match?.index === 0) return { index: knownHostIndex, tail: match[1] };
  }
  for (const pattern of [HOST_PATH_PROMPT_SUFFIX_RE, PATH_PROMPT_SUFFIX_RE, HOST_PERCENT_PROMPT_SUFFIX_RE]) {
    const match = pattern.exec(text);
    if (match) return { index: match.index, tail: match[1] };
  }
  const simple = SIMPLE_PROMPT_RE.exec(text);
  if (simple) return { index: 0, tail: simple[1] };
  return null;
};

export const looksLikeShellPrompt = (text: string): boolean => matchPromptSuffix(text) !== null;

export const findPrimaryPromptBeforeCursor = (
  buffer: ITerminalTextBuffer,
  cursorLine: number,
  cursorColumn: number,
  knownTail?: string,
): IPromptBoundary | null => {
  const current = lineTextToColumn(buffer, cursorLine, cursorColumn);
  const match = matchPromptSuffix(current, knownTail);
  if (!match) return null;

  let start = { line: cursorLine, column: match.index };
  if (SIMPLE_PROMPT_RE.test(match.tail) && cursorLine > 0) {
    const previous = buffer.getLine(cursorLine - 1);
    if (previous && !previous.isWrapped) {
      const pathLine = PATH_ONLY_LINE_RE.exec(previous.translateToString(true));
      if (pathLine) start = { line: cursorLine - 1, column: pathLine.index };
    }
  }

  return {
    start,
    end: { line: cursorLine, column: cursorColumn },
    tail: match.tail,
  };
};

const findCommandPrompt = (
  buffer: ITerminalTextBuffer,
  line: number,
): IPromptBoundary | null => {
  const current = buffer.getLine(line);
  if (!current || current.isWrapped) return null;
  const text = current.translateToString(true);

  for (const pattern of [
    HOST_PATH_PROMPT_WITH_COMMAND_RE,
    PATH_PROMPT_WITH_COMMAND_RE,
    HOST_PERCENT_PROMPT_WITH_COMMAND_RE,
    SIMPLE_PROMPT_WITH_COMMAND_RE,
  ]) {
    const match = pattern.exec(text);
    if (!match) continue;
    let start = { line, column: 0 };
    if (pattern === SIMPLE_PROMPT_WITH_COMMAND_RE && line > 0) {
      const previous = buffer.getLine(line - 1);
      const previousText = previous && !previous.isWrapped ? previous.translateToString(true) : '';
      const pathLine = PATH_ONLY_LINE_RE.exec(previousText);
      if (pathLine) start = { line: line - 1, column: pathLine.index };
    }
    return {
      start,
      end: { line, column: match[1].length },
      tail: match[1],
    };
  }
  return null;
};

export const findShellCommandRange = (
  buffer: ITerminalTextBuffer,
  targetLine: number,
  targetColumn = 0,
): ITerminalTextRange | null => {
  let commandPrompt: IPromptBoundary | null = null;
  for (let y = Math.min(targetLine, buffer.length - 1); y >= 0; y--) {
    commandPrompt = findCommandPrompt(buffer, y);
    if (commandPrompt) break;
  }
  if (!commandPrompt) return null;

  const finalLine = buffer.length - 1;
  let end = { line: finalLine, column: buffer.getLine(finalLine)?.length ?? 0 };
  for (let y = commandPrompt.end.line + 1; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    if (!line || line.isWrapped) continue;
    const boundary = findCommandPrompt(buffer, y) ?? findPrimaryPromptBeforeCursor(
      buffer,
      y,
      line.translateToString(true).length,
      commandPrompt.tail,
    );
    if (boundary && (
      boundary.start.line > commandPrompt.end.line
      || boundary.start.column > commandPrompt.end.column
    )) {
      end = boundary.start;
      break;
    }
  }

  const target = { line: targetLine, column: targetColumn };
  const targetAfterStart = target.line > commandPrompt.start.line
    || (target.line === commandPrompt.start.line && target.column >= commandPrompt.start.column);
  const targetBeforeEnd = target.line < end.line
    || (target.line === end.line && target.column < end.column);
  return targetAfterStart && targetBeforeEnd ? { start: commandPrompt.start, end } : null;
};

export const serializeTerminalSpan = (
  buffer: ITerminalTextBuffer,
  range: ITerminalTextRange,
): string => {
  if (buffer.length === 0) return '';
  const first = Math.max(0, range.start.line);
  const last = Math.min(range.end.line, buffer.length - 1);
  if (last < first || (last === first && range.end.column <= range.start.column)) return '';

  let text = '';
  let hasLine = false;
  for (let y = first; y <= last; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const startColumn = y === first ? range.start.column : 0;
    const endColumn = y === range.end.line ? range.end.column : undefined;
    if (endColumn === 0) break;
    if (hasLine && !line.isWrapped) text += '\n';
    text += line.translateToString(endColumn === undefined, startColumn, endColumn);
    hasLine = true;
  }

  return text.replace(/\s+$/g, '');
};

export const serializeTerminalRange = (
  buffer: ITerminalTextBuffer,
  start: number,
  end: number,
): string => serializeTerminalSpan(buffer, {
  start: { line: start, column: 0 },
  end: { line: end, column: buffer.getLine(end)?.length ?? 0 },
});
