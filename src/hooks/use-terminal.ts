import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
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
import { getPromptBlockText, syncPromptCopyButtons } from "@/lib/terminal-prompt-copy";
import isElectron from "@/hooks/use-is-electron";

interface IUseTerminalOptions {
  readOnly?: boolean;
  theme?: ITerminalThemeColors;
  fontSize?: number;
  lineHeight?: number;
  onInput?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onTitleChange?: (title: string) => void;
  customKeyEventHandler?: (event: KeyboardEvent) => boolean;
  enablePromptCopy?: boolean;
  promptPrefix?: string;
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

const useTerminal = ({ readOnly = false, theme, fontSize = DEFAULT_FONT_SIZE, lineHeight = DEFAULT_LINE_HEIGHT, onInput, onResize, onTitleChange, customKeyEventHandler, enablePromptCopy = false, promptPrefix = '' }: IUseTerminalOptions = {}) => {
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const terminalRef = useCallback((node: HTMLDivElement | null) => {
    setContainerNode(node);
  }, []);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writeQueueRef = useRef<Uint8Array[]>([]);
  const isWritingRef = useRef(false);
  const promptCopySyncRef = useRef<() => void>(() => {});
  const [isReady, setIsReady] = useState(false);
  const t = useTranslations('terminal');

  const callbacksRef = useRef({ theme, fontSize, lineHeight, onInput, onResize, onTitleChange, customKeyEventHandler, promptPrefix, t });

  useEffect(() => {
    callbacksRef.current = { theme, fontSize, lineHeight, onInput, onResize, onTitleChange, customKeyEventHandler, promptPrefix, t };
  }, [theme, fontSize, lineHeight, onInput, onResize, onTitleChange, customKeyEventHandler, promptPrefix, t]);

  useEffect(() => {
    promptCopySyncRef.current();
  }, [promptPrefix]);

  useEffect(() => {
    const label = t('copyPromptBlockLabel');
    containerNode?.querySelectorAll<HTMLButtonElement>('.terminal-prompt-copy-button').forEach((button) => {
      button.setAttribute('aria-label', label);
      button.title = label;
    });
  }, [containerNode, t]);

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

    if (!readOnly) fitAddon.fit();
    return { cols: terminal.cols, rows: terminal.rows };
  }, [readOnly]);

  const reset = useCallback(() => {
    writeQueueRef.current = [];
    isWritingRef.current = false;
    terminalInstance.current?.reset();
  }, []);

  const focus = useCallback(() => {
    terminalInstance.current?.focus();
  }, []);

  useEffect(() => {
    if (!containerNode) return;

    let disposed = false;
    let resizeRaf = 0;
    let reFitTimer = 0;
    let promptCopyRaf = 0;
    let resizeObserver: ResizeObserver | null = null;
    let promptCopyResizeObserver: ResizeObserver | null = null;
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
        disableStdin: readOnly,
        windowOptions: { setWinSizeChars: readOnly },
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
      if (!readOnly) terminal.loadAddon(new ClipboardAddon(undefined, clipboardProvider));

      if (readOnly) {
        // Observation snapshots carry external geometry as CSI 8;rows;cols t.
        // Resize only this renderer; no managed terminal callbacks or tmux commands.
        terminal.parser.registerCsiHandler({ final: 't' }, (params) => {
          if (params.length === 3 && params[0] === 8
            && typeof params[1] === 'number' && typeof params[2] === 'number'
            && params[1] > 0 && params[2] > 0) {
            terminal.resize(params[2], params[1]);
            return true;
          }
          return false;
        });
      }

      terminal.open(containerNode);

      if (enablePromptCopy && terminal.element) {
        containerNode.classList.add('terminal-prompt-copy-enabled');
        const gutter = document.createElement('div');
        gutter.className = 'terminal-prompt-copy-gutter';
        gutter.setAttribute('aria-hidden', 'false');
        terminal.element.appendChild(gutter);

        const copyPromptBlock = async (row: number) => {
          const buffer = terminal.buffer.active;
          const text = getPromptBlockText(buffer, row, callbacksRef.current.promptPrefix);
          if (!text) return;
          const ok = await copyToClipboard(text);
          if (ok) {
            toast.success(callbacksRef.current.t('copyPaneSuccess'), {
              id: COPY_TOAST_ID,
              duration: 1500,
            });
          }
        };

        const syncPromptButtons = () => {
          promptCopyRaf = 0;
          const buffer = terminal.buffer.active;
          const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen');
          if (!screen || !terminal.element) return;
          const terminalRect = terminal.element.getBoundingClientRect();
          const screenRect = screen.getBoundingClientRect();
          syncPromptCopyButtons({
            gutter,
            buffer,
            viewportY: buffer.viewportY,
            viewportRows: terminal.rows,
            screenTop: screenRect.top - terminalRect.top,
            screenHeight: screenRect.height,
            label: callbacksRef.current.t('copyPromptBlockLabel'),
            onCopy: copyPromptBlock,
            promptPrefix: callbacksRef.current.promptPrefix,
          });
        };

        const schedulePromptButtonSync = () => {
          if (promptCopyRaf) return;
          promptCopyRaf = requestAnimationFrame(syncPromptButtons);
        };
        promptCopySyncRef.current = schedulePromptButtonSync;

        terminal.onScroll(schedulePromptButtonSync);
        terminal.onResize(schedulePromptButtonSync);
        terminal.onWriteParsed(schedulePromptButtonSync);

        const screen = terminal.element.querySelector<HTMLElement>('.xterm-screen');
        if (screen) {
          promptCopyResizeObserver = new ResizeObserver(schedulePromptButtonSync);
          promptCopyResizeObserver.observe(screen);
        }
        schedulePromptButtonSync();
      }

      terminalInstance.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.onData((data) => {
        if (readOnly) return;
        if (/^\x1b\[[\?>]?[\d;]*[cnR]$/.test(data)) return;
        callbacksRef.current.onInput?.(data);
      });

      terminal.onTitleChange((title) => {
        callbacksRef.current.onTitleChange?.(title);
      });

      terminal.attachCustomKeyEventHandler((event) => {
        if (readOnly) return false;
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
        if (readOnly) return;
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

      if (!readOnly && isTouchDevice && screenEl) {
        let lastY = 0;
        let touchStartedOnPromptButton = false;

        const onTouchStart = (e: TouchEvent) => {
          touchStartedOnPromptButton = e.target instanceof Element
            && e.target.closest('.terminal-prompt-copy-button') !== null;
          lastY = e.touches[0].clientY;
        };

        const onTouchMove = (e: TouchEvent) => {
          if (touchStartedOnPromptButton) return;
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
      cancelAnimationFrame(promptCopyRaf);
      clearTimeout(reFitTimer);
      resizeObserver?.disconnect();
      promptCopyResizeObserver?.disconnect();
      promptCopySyncRef.current = () => {};
      cleanupTouch?.();
      containerNode.classList.remove('terminal-prompt-copy-enabled');
      terminalInstance.current?.dispose();
      terminalInstance.current = null;
      fitAddonRef.current = null;
    };
  }, [containerNode, enablePromptCopy, readOnly]);

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
    if (!readOnly) {
      fitAddonRef.current?.fit();
      callbacksRef.current.onResize?.(terminal.cols, terminal.rows);
    }
  }, [fontSize, lineHeight, readOnly]);

  return { terminalRef, write, clear, reset, fit, focus, isReady, getBufferText };
};

export default useTerminal;
