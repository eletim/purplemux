export interface ITerminalTextCell {
  getChars(): string;
  getWidth(): number;
}

export interface ITerminalTextLine {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell?(x: number): ITerminalTextCell | undefined;
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

export interface IPromptSignature {
  tail: string;
  multilinePrefix: string | null;
}

export interface IPromptBoundary extends ITerminalTextRange {
  signature: IPromptSignature;
}

interface ILogicalLine {
  text: string;
  startLine: number;
  endLine: number;
  positionAt(index: number): ITerminalPosition;
}

const SIMPLE_PROMPT_RE = /^([#$%❯➜]\s)$/;
const SIMPLE_PROMPT_WITH_COMMAND_RE = /^([#$%❯➜]\s)\S/;
const HOST_PATH_PROMPT_SUFFIX_RE = /([\w.-]+@[\w.-]+:(?:~|\/).*?[#$%>❯➜]\s)$/;
const HOST_PATH_PROMPT_WITH_COMMAND_RE = /([\w.-]+@[\w.-]+:(?:~|\/).*?[#$%>❯➜]\s)\S/;
const PATH_PROMPT_SUFFIX_RE = /((?:~|\/).*?[#$%❯➜]\s)$/;
const PATH_PROMPT_WITH_COMMAND_RE = /((?:~|\/).*?[#$%❯➜]\s)\S/;
const HOST_PERCENT_PROMPT_SUFFIX_RE = /([\w.-]+%\s)$/;
const HOST_PERCENT_PROMPT_WITH_COMMAND_RE = /([\w.-]+%\s)\S/;
const HOST_PATH_PREFIX_RE = /^([\w.-]+@[\w.-]+:)(?:~|\/)/;
const PATH_ONLY_PREFIX_RE = /^(?:~|\/).+$/;

export const findLogicalLineStart = (buffer: ITerminalTextBuffer, line: number): number => {
  let start = Math.max(0, Math.min(line, buffer.length - 1));
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  return start;
};

const getTextEndColumn = (line: ITerminalTextLine): number => {
  if (!line.getCell) return line.translateToString(true).length;
  let end = 0;
  for (let column = 0; column < line.length; column++) {
    const cell = line.getCell(column);
    if (cell?.getChars()) end = column + Math.max(1, cell.getWidth());
  }
  return end;
};

const readLogicalLine = (
  buffer: ITerminalTextBuffer,
  endLine: number,
  endColumn: number,
): ILogicalLine => {
  const startLine = findLogicalLineStart(buffer, endLine);
  const offsets: Array<{ index: number; position: ITerminalPosition }> = [
    { index: 0, position: { line: startLine, column: 0 } },
  ];
  let text = '';

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    const line = buffer.getLine(lineNumber);
    if (!line) continue;
    const limit = lineNumber === endLine ? endColumn : line.length;
    if (line.getCell) {
      for (let column = 0; column < limit; column++) {
        const cell = line.getCell(column);
        const chars = cell?.getChars() ?? '';
        if (!chars) continue;
        offsets.push({ index: text.length, position: { line: lineNumber, column } });
        text += chars;
        offsets.push({
          index: text.length,
          position: { line: lineNumber, column: column + Math.max(1, cell?.getWidth() ?? 1) },
        });
      }
    } else {
      const chunk = line.translateToString(false, 0, limit);
      for (let index = 0; index <= chunk.length; index++) {
        offsets.push({ index: text.length + index, position: { line: lineNumber, column: index } });
      }
      text += chunk;
    }
  }

  return {
    text,
    startLine,
    endLine,
    positionAt: (index) => {
      for (let i = offsets.length - 1; i >= 0; i--) {
        if (offsets[i].index <= index) return offsets[i].position;
      }
      return { line: startLine, column: 0 };
    },
  };
};

const readCompleteLogicalLine = (buffer: ITerminalTextBuffer, startLine: number): ILogicalLine => {
  let endLine = startLine;
  while (endLine + 1 < buffer.length && buffer.getLine(endLine + 1)?.isWrapped) endLine++;
  const end = buffer.getLine(endLine);
  return readLogicalLine(buffer, endLine, end ? getTextEndColumn(end) : 0);
};

const matchPromptSuffix = (
  text: string,
  known?: IPromptSignature,
): { index: number; tail: string } | null => {
  if (known?.tail && text.endsWith(known.tail)) {
    return { index: text.length - known.tail.length, tail: known.tail };
  }
  const knownHostMatch = known?.tail.match(/([\w.-]+@[\w.-]+:)/);
  if (knownHostMatch?.index !== undefined) {
    const stablePrefix = known!.tail.slice(0, knownHostMatch.index) + knownHostMatch[1];
    const stablePrefixIndex = text.lastIndexOf(stablePrefix);
    if (stablePrefixIndex >= 0) {
      const hostIndex = stablePrefixIndex + stablePrefix.length - knownHostMatch[1].length;
      const match = HOST_PATH_PROMPT_SUFFIX_RE.exec(text.slice(hostIndex));
      if (match?.index === 0) {
        return { index: stablePrefixIndex, tail: text.slice(stablePrefixIndex) };
      }
    }
  }
  const knownPathMatch = known?.tail.match(/(?:~|\/)/);
  const knownDecoration = knownPathMatch?.index ? known!.tail.slice(0, knownPathMatch.index) : '';
  if (knownDecoration) {
    const decorationIndex = text.lastIndexOf(knownDecoration);
    if (decorationIndex >= 0) {
      const match = PATH_PROMPT_SUFFIX_RE.exec(text.slice(decorationIndex + knownDecoration.length));
      if (match?.index === 0) {
        return { index: decorationIndex, tail: text.slice(decorationIndex) };
      }
    }
  }
  for (const pattern of [HOST_PATH_PROMPT_SUFFIX_RE, PATH_PROMPT_SUFFIX_RE, HOST_PERCENT_PROMPT_SUFFIX_RE]) {
    const match = pattern.exec(text);
    if (match) return known
      ? { index: match.index, tail: match[1] }
      : { index: 0, tail: text };
  }
  const simple = SIMPLE_PROMPT_RE.exec(text);
  return simple ? { index: 0, tail: simple[1] } : null;
};

export const looksLikeShellPrompt = (text: string): boolean => matchPromptSuffix(text) !== null;

const findMultilinePrefix = (
  buffer: ITerminalTextBuffer,
  promptLine: number,
  known?: IPromptSignature,
): { start: ITerminalPosition; identity: string } | null => {
  if (known && !known.multilinePrefix) return null;
  if (promptLine <= 0) return null;
  const previousEndLine = promptLine - 1;
  const previousEnd = buffer.getLine(previousEndLine);
  if (!previousEnd) return null;
  const previous = readLogicalLine(buffer, previousEndLine, getTextEndColumn(previousEnd));
  const identity = HOST_PATH_PREFIX_RE.exec(previous.text)?.[1]
    ?? (PATH_ONLY_PREFIX_RE.test(previous.text) ? 'path-only' : null);
  if (!identity) return null;
  if (known?.multilinePrefix && identity !== known.multilinePrefix) return null;
  return { start: previous.positionAt(0), identity };
};

export const findPrimaryPromptBeforeCursor = (
  buffer: ITerminalTextBuffer,
  cursorLine: number,
  cursorColumn: number,
  known?: IPromptSignature,
): IPromptBoundary | null => {
  const logical = readLogicalLine(buffer, cursorLine, cursorColumn);
  const match = matchPromptSuffix(logical.text, known);
  if (!match) return null;

  let start = logical.positionAt(match.index);
  let multilinePrefix: string | null = null;
  if (SIMPLE_PROMPT_RE.test(match.tail)) {
    const prefix = findMultilinePrefix(buffer, logical.startLine, known);
    if (prefix) {
      start = prefix.start;
      multilinePrefix = prefix.identity;
    }
  }

  return {
    start,
    end: { line: cursorLine, column: cursorColumn },
    signature: { tail: match.tail, multilinePrefix },
  };
};

const findCommandPrompt = (
  buffer: ITerminalTextBuffer,
  line: number,
): IPromptBoundary | null => {
  const firstLine = buffer.getLine(line);
  if (!firstLine || firstLine.isWrapped) return null;
  const logical = readCompleteLogicalLine(buffer, line);

  for (const pattern of [
    HOST_PATH_PROMPT_WITH_COMMAND_RE,
    PATH_PROMPT_WITH_COMMAND_RE,
    HOST_PERCENT_PROMPT_WITH_COMMAND_RE,
    SIMPLE_PROMPT_WITH_COMMAND_RE,
  ]) {
    const match = pattern.exec(logical.text);
    if (!match) continue;
    let start = logical.positionAt(0);
    let multilinePrefix: string | null = null;
    if (pattern === SIMPLE_PROMPT_WITH_COMMAND_RE) {
      const prefix = findMultilinePrefix(buffer, logical.startLine);
      if (prefix) {
        start = prefix.start;
        multilinePrefix = prefix.identity;
      }
    }
    return {
      start,
      end: logical.positionAt(match.index + match[1].length),
      signature: {
        tail: logical.text.slice(0, match.index + match[1].length),
        multilinePrefix,
      },
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
  for (let line = Math.min(targetLine, buffer.length - 1); line >= 0; line--) {
    commandPrompt = findCommandPrompt(buffer, line);
    if (commandPrompt) break;
  }
  if (!commandPrompt) return null;

  const finalLine = buffer.length - 1;
  const finalBufferLine = buffer.getLine(finalLine);
  let end = { line: finalLine, column: finalBufferLine ? getTextEndColumn(finalBufferLine) : 0 };
  for (let line = commandPrompt.end.line + 1; line < buffer.length; line++) {
    const bufferLine = buffer.getLine(line);
    if (!bufferLine || bufferLine.isWrapped) continue;
    const logical = readCompleteLogicalLine(buffer, line);
    const boundary = findPrimaryPromptBeforeCursor(
      buffer,
      logical.endLine,
      getTextEndColumn(buffer.getLine(logical.endLine)!),
      commandPrompt.signature,
    ) ?? findCommandPrompt(buffer, line);
    if (boundary && (
      boundary.start.line > commandPrompt.end.line
      || boundary.start.column > commandPrompt.end.column
    )) {
      end = boundary.start;
      break;
    }
  }

  const targetAfterStart = targetLine > commandPrompt.start.line
    || (targetLine === commandPrompt.start.line && targetColumn >= commandPrompt.start.column);
  const targetBeforeEnd = targetLine < end.line
    || (targetLine === end.line && targetColumn < end.column);
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
  for (let lineNumber = first; lineNumber <= last; lineNumber++) {
    const line = buffer.getLine(lineNumber);
    if (!line) continue;
    const startColumn = lineNumber === first ? range.start.column : 0;
    const endColumn = lineNumber === range.end.line ? range.end.column : undefined;
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
  end: { line: end, column: buffer.getLine(end) ? getTextEndColumn(buffer.getLine(end)!) : 0 },
});
