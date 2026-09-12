import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { ClipboardAddon, type IClipboardProvider } from "@xterm/addon-clipboard";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ITerminalThemeColors } from "@/lib/terminal-themes";
import { createMultilineUrlLinkProvider } from "@/lib/multiline-url-link-provider";
import { copyToClipboard } from "@/lib/clipboard";
import { DEFAULT_LINE_HEIGHT } from "@/lib/terminal-line-height";
import isElectron from "@/hooks/use-is-electron";
import {
  findLogicalLineStart,
  findShellCommandRange,
  looksLikeShellPrompt,
  serializeTerminalRange,
  type ITerminalLineRange,
} from '@/lib/terminal-command-output';

interface IUseTerminalOptions {
  theme?: ITerminalThemeColors;
  fontSize?: number;
  lineHeight?: number;
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onTitleChange?: (title: string) => void;
  customKeyEventHandler?: (event: KeyboardEvent) => boolean;
  trackCommands?: boolean;
}

interface ITrackedCommand {
  start: IMarker;
  end: IMarker | null;
}

const COPY_TOAST_ID = 'terminal-copy';

const DEFAULT_FONT_SIZE = 12;

const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:'];

const openExternalUrl = (uri: string) => {
  try {
    const { protocol } = new URL(uri);
    if (!ALLOWED_LINK_PROTOCOLS.includes(protocol)) return;
  } catch {
    return;
  }
  if (isElectron) {
    (window as unknown as Record<string, { openExternal: (url: string) => void }>).electronAPI.openExternal(uri);
  } else {
    window.open(uri, '_blank');
  }
};

const FONT_FAMILY =
  "'MesloLGLDZ', 'Apple SD Gothic Neo', 'Pretendard', 'Menlo', 'Monaco', 'Courier New', monospace";

let fontLoadPromise: Promise<void> | null = null;
const loadFonts = () => {
  fontLoadPromise ??= (async () => {
    const fontsToLoad = [
      new FontFace('MesloLGLDZ', "url('/fonts/MesloLGLDZNerdFont-Regular.woff2')", {
        weight: '400',
        style: 'normal',
      }),
      new FontFace('MesloLGLDZ', "url('/fonts/MesloLGLDZNerdFont-Bold.woff2')", {
        weight: '700',
        style: 'normal',
      }),
    ];
    await Promise.all(
      fontsToLoad.map(async (font) => {
        await font.load();
        document.fonts.add(font);
      }),
    );
  })();
  return fontLoadPromise;
};

const useTerminal = ({ theme, fontSize = DEFAULT_FONT_SIZE, lineHeight = DEFAULT_LINE_HEIGHT, onInput, onResize, onTitleChange, customKeyEventHandler, trackCommands = false }: IUseTerminalOptions = {}) => {
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const terminalRef = useCallback((node: HTMLDivElement | null) => {
    setContainerNode(node);
  }, []);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writeQueueRef = useRef<Uint8Array[]>([]);
  const isWritingRef = useRef(false);
  const [isReady, setIsReady] = useState(false);
  const trackedCommandsRef = useRef<ITrackedCommand[]>([]);
  const pendingInputRef = useRef(false);
  const commandCopyTargetRef = useRef<ITrackedCommand | null>(null);
  const fallbackCopyRangeRef = useRef<ITerminalLineRange | null>(null);
  const t = useTranslations('terminal');

  const callbacksRef = useRef({ theme, fontSize, lineHeight, onInput, onResize, onTitleChange, customKeyEventHandler, trackCommands, t });

  useEffect(() => {
    callbacksRef.current = { theme, fontSize, lineHeight, onInput, onResize, onTitleChange, customKeyEventHandler, trackCommands, t };
  }, [theme, fontSize, lineHeight, onInput, onResize, onTitleChange, customKeyEventHandler, trackCommands, t]);

  const disposeTrackedCommands = useCallback(() => {
    for (const command of trackedCommandsRef.current) {
      command.start.dispose();
      command.end?.dispose();
    }
    trackedCommandsRef.current = [];
    commandCopyTargetRef.current = null;
    fallbackCopyRangeRef.current = null;
    pendingInputRef.current = false;
  }, []);

  const markLine = useCallback((terminal: Terminal, line: number): IMarker | undefined => {
    const buffer = terminal.buffer.active;
    return terminal.registerMarker(line - (buffer.baseY + buffer.cursorY));
  }, []);

  const trackCommandInput = useCallback((data: string) => {
    if (!callbacksRef.current.trackCommands) return;
    const terminal = terminalInstance.current;
    if (!terminal || terminal.buffer.active.type !== 'normal') return;

    for (const part of data.split(/(\r|\n)/)) {
      if (part === '\r' || part === '\n') {
        if (!pendingInputRef.current) continue;
        const buffer = terminal.buffer.active;
        const cursorLine = buffer.baseY + buffer.cursorY;
        const startLine = findLogicalLineStart(buffer, cursorLine);
        const commands = trackedCommandsRef.current;
        const previous = commands.at(-1);
        if (previous && !previous.end) previous.end = markLine(terminal, startLine - 1) ?? null;
        const start = markLine(terminal, startLine);
        if (start) commands.push({ start, end: null });
        while (commands.length > 50) {
          const removed = commands.shift();
          removed?.start.dispose();
          removed?.end?.dispose();
        }
        pendingInputRef.current = false;
      } else if (part && /[^\x00-\x1f\x7f]/.test(part)) {
        pendingInputRef.current = true;
      }
    }
  }, [markLine]);

  const resolveCommandEnd = useCallback((terminal: Terminal, command: ITrackedCommand): number => {
    if (command.end) return command.end.line;
    const buffer = terminal.buffer.active;
    const cursorLine = buffer.baseY + buffer.cursorY;
    const logicalStart = findLogicalLineStart(buffer, cursorLine);
    const currentLine = serializeTerminalRange(buffer, logicalStart, cursorLine);
    return logicalStart > command.start.line && looksLikeShellPrompt(currentLine)
      ? logicalStart - 1
      : cursorLine;
  }, []);

  const setCommandCopyTarget = useCallback((clientY: number) => {
    const terminal = terminalInstance.current;
    const element = terminal?.element;
    if (!terminal || !element) return;
    const rect = element.getBoundingClientRect();
    const viewportRow = Math.max(0, Math.min(terminal.rows - 1, Math.floor((clientY - rect.top) / rect.height * terminal.rows)));
    const bufferLine = terminal.buffer.active.viewportY + viewportRow;
    commandCopyTargetRef.current = [...trackedCommandsRef.current].reverse().find((command) => (
      bufferLine >= command.start.line && bufferLine <= resolveCommandEnd(terminal, command)
    )) ?? null;
    fallbackCopyRangeRef.current = commandCopyTargetRef.current
      ? null
      : findShellCommandRange(terminal.buffer.active, bufferLine);
  }, [resolveCommandEnd]);

  const getCommandAndOutput = useCallback((): string => {
    const terminal = terminalInstance.current;
    if (!terminal || terminal.buffer.active.type !== 'normal') return '';
    const targetedCommand = commandCopyTargetRef.current;
    const fallbackRange = fallbackCopyRangeRef.current;
    if (!targetedCommand && fallbackRange) {
      return serializeTerminalRange(terminal.buffer.active, fallbackRange.start, fallbackRange.end);
    }
    const command = targetedCommand ?? trackedCommandsRef.current.at(-1);
    if (!command) return '';
    if (command.start.isDisposed || command.end?.isDisposed) return '';
    return serializeTerminalRange(
      terminal.buffer.active,
      command.start.line,
      resolveCommandEnd(terminal, command),
    );
  }, [resolveCommandEnd]);

  const write = useCallback((data: Uint8Array) => {
    writeQueueRef.current.push(data);
    if (!isWritingRef.current) {
      isWritingRef.current = true;
      const flush = () => {
        requestAnimationFrame(() => {
          const terminal = terminalInstance.current;
          const queue = writeQueueRef.current;
          if (!terminal || queue.length === 0) {
            isWritingRef.current = false;
            return;
          }

          const startTime = performance.now();
          let consumed = 0;
          while (consumed < queue.length && performance.now() - startTime < 12) {
            terminal.write(queue[consumed]);
            consumed++;
          }

          if (consumed >= queue.length) {
            queue.length = 0;
            isWritingRef.current = false;
          } else {
            writeQueueRef.current = queue.slice(consumed);
            flush();
          }
        });
      };
      flush();
    }
  }, []);

  const clear = useCallback(() => {
    terminalInstance.current?.clear();
  }, []);

  const getBufferText = useCallback((): string => {
    const term = terminalInstance.current;
    if (!term) return '';
    const buf = term.buffer.active;
    const start = Math.max(0, buf.length - term.rows);
    const lines: string[] = [];
    for (let y = start; y < buf.length; y++) {
      const line = buf.getLine(y);
      lines.push(line ? line.translateToString(true) : '');
    }
    return lines.join('\n');
  }, []);

  const fit = useCallback((): { cols: number; rows: number } => {
    const fitAddon = fitAddonRef.current;
    const terminal = terminalInstance.current;
    if (!fitAddon || !terminal) return { cols: 80, rows: 24 };

    fitAddon.fit();
    return { cols: terminal.cols, rows: terminal.rows };
  }, []);

  const reset = useCallback(() => {
    disposeTrackedCommands();
    writeQueueRef.current = [];
    isWritingRef.current = false;
    terminalInstance.current?.reset();
  }, [disposeTrackedCommands]);

  const focus = useCallback(() => {
    terminalInstance.current?.focus();
  }, []);

  useEffect(() => {
    if (!containerNode) return;

    let disposed = false;
    let resizeRaf = 0;
    let reFitTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    let cleanupTouch: (() => void) | null = null;

    loadFonts().then(() => {
      if (disposed) return;

      const terminal = new Terminal({
        fontFamily: FONT_FAMILY,
        fontWeight: "400",
        fontWeightBold: "700",
        fontSize: callbacksRef.current.fontSize,
        lineHeight: callbacksRef.current.lineHeight,
        letterSpacing: 0,
        scrollback: 5000,
        cursorBlink: false,
        cursorStyle: "bar",
        allowTransparency: false,
        allowProposedApi: true,
        macOptionIsMeta: true,
        theme: callbacksRef.current.theme,
        linkHandler: {
          activate: (_event, text) => openExternalUrl(text),
          allowNonHttpProtocols: false,
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.registerLinkProvider(createMultilineUrlLinkProvider(terminal, openExternalUrl));
      terminal.loadAddon(new WebLinksAddon((_event, uri) => openExternalUrl(uri)));

      const unicode11Addon = new Unicode11Addon();
      terminal.loadAddon(unicode11Addon);
      terminal.unicode.activeVersion = "11";

      const clipboardProvider: IClipboardProvider = {
        // OSC 52 read는 터미널 앱이 브라우저 클립보드를 훔쳐볼 수 있어 거부한다
        readText: () => '',
        writeText: async (_selection, text) => {
          if (!text) return;
          const ok = await copyToClipboard(text);
          if (ok) {
            toast.success(callbacksRef.current.t('copyPaneSuccess'), { id: COPY_TOAST_ID, duration: 1500 });
          }
          // 실패 시 브라우저 권한/포커스 이슈는 조용히 무시
        },
      };
      terminal.loadAddon(new ClipboardAddon(undefined, clipboardProvider));

      terminal.open(containerNode);

      terminalInstance.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.onData((data) => {
        if (/^\x1b\[[\?>]?[\d;]*[cnR]$/.test(data)) return;
        callbacksRef.current.onInput?.(data);
      });

      terminal.onTitleChange((title) => {
        callbacksRef.current.onTitleChange?.(title);
      });

      terminal.attachCustomKeyEventHandler((event) => {
        // IME 조합 단계의 keydown(keyCode 229)은 가로채지 않는다. 같은 키가 조합용으로 한 번,
        // 실제 키로 한 번 들어오므로 실제 키만 처리해 중복 전송(단어 2칸 이동 등)을 막는다.
        if (event.isComposing || event.keyCode === 229) return true;
        // macOptionIsMeta가 이중 ESC를 보내는 키만 직접 매핑
        if (event.altKey && event.type === 'keydown') {
          const seq: Record<string, string> = {
            ArrowLeft: '\x1bb',
            ArrowRight: '\x1bf',
            Backspace: '\x1b\x7f',
          };
          if (seq[event.code]) {
            // preventDefault로 hidden textarea의 네이티브 단어 단위 커서 이동을 막는다.
            // 막지 않으면 IME 조합 중 캐럿이 textarea 앞으로 이동해 xterm CompositionHelper의
            // "조합은 항상 끝에서 일어난다" 가정이 깨지고 이전 입력이 반복 전송된다.
            event.preventDefault();
            callbacksRef.current.onInput?.(seq[event.code]);
            return false;
          }
        }
        return callbacksRef.current.customKeyEventHandler?.(event) ?? true;
      });

      const doFit = () => {
        fitAddon.fit();
        callbacksRef.current.onResize?.(terminal.cols, terminal.rows);
      };

      doFit();
      setIsReady(true);

      // 비동기 레이아웃 안정화 대기 (HMR, 패널 초기화 등)
      reFitTimer = window.setTimeout(() => {
        if (disposed) return;
        doFit();
      }, 500);

      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          if (disposed) return;
          doFit();
        });
      });

      resizeObserver.observe(containerNode);

      // 모바일 터치 → 합성 WheelEvent 변환 (tmux 스크롤 지원)
      // tmux mouse mode 시 xterm.js가 .xterm-screen에 wheel 리스너를 붙이므로 해당 요소에 dispatch
      const isTouchDevice = 'ontouchstart' in window && navigator.maxTouchPoints > 0;
      const screenEl = containerNode.querySelector('.xterm-screen');

      if (isTouchDevice && screenEl) {
        let lastY = 0;

        const onTouchStart = (e: TouchEvent) => {
          lastY = e.touches[0].clientY;
        };

        const onTouchMove = (e: TouchEvent) => {
          const currentY = e.touches[0].clientY;
          const deltaY = lastY - currentY;
          lastY = currentY;

          if (Math.abs(deltaY) < 3) return;

          e.preventDefault();
          screenEl.dispatchEvent(
            new WheelEvent('wheel', {
              deltaY,
              clientX: e.touches[0].clientX,
              clientY: e.touches[0].clientY,
              bubbles: true,
            })
          );
        };

        containerNode.addEventListener('touchstart', onTouchStart, { passive: true });
        containerNode.addEventListener('touchmove', onTouchMove, { passive: false });
        cleanupTouch = () => {
          containerNode.removeEventListener('touchstart', onTouchStart);
          containerNode.removeEventListener('touchmove', onTouchMove);
        };
      }
    });

    return () => {
      disposed = true;
      setIsReady(false);
      cancelAnimationFrame(resizeRaf);
      clearTimeout(reFitTimer);
      resizeObserver?.disconnect();
      cleanupTouch?.();
      disposeTrackedCommands();
      terminalInstance.current?.dispose();
      terminalInstance.current = null;
      fitAddonRef.current = null;
    };
  }, [containerNode, disposeTrackedCommands]);

  useEffect(() => {
    if (terminalInstance.current && theme) {
      terminalInstance.current.options.theme = theme;
    }
  }, [theme]);

  useEffect(() => {
    const terminal = terminalInstance.current;
    if (!terminal || !fontSize || !lineHeight) return;
    terminal.options.fontSize = fontSize;
    terminal.options.lineHeight = lineHeight;
    fitAddonRef.current?.fit();
    callbacksRef.current.onResize?.(terminal.cols, terminal.rows);
  }, [fontSize, lineHeight]);

  return { terminalRef, write, clear, reset, fit, focus, isReady, getBufferText, trackCommandInput, setCommandCopyTarget, getCommandAndOutput };
};

export default useTerminal;
