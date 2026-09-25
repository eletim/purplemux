import { useEffect, useRef } from 'react';
import useConfigStore from '@/hooks/use-config-store';
import useTerminal from '@/hooks/use-terminal';
import useTerminalTheme from '@/hooks/use-terminal-theme';
import useTerminalWebSocket from '@/hooks/use-terminal-websocket';
import { resolveLineHeight } from '@/lib/terminal-line-height';
import type { IExternalTerminalTarget } from '@/types/terminal';

type TFontSizeMode = 'configured' | 'agent' | 'mobile' | 'default';

interface IUseTerminalSurfaceOptions {
  externalTarget?: { id: string; windowId: string };
  externalTerminalTarget?: IExternalTerminalTarget;
  fontSizeMode?: TFontSizeMode;
  onInput?: (data: string, sendStdin: (data: string) => void) => void;
  onResize?: (cols: number, rows: number) => void;
  onTitleChange?: (title: string) => void;
  customKeyEventHandler?: (event: KeyboardEvent) => boolean;
  onData?: (data: Uint8Array) => void;
  onConnected?: () => void;
  onSessionEnded?: () => void;
}

const FONT_SIZES: Record<string, { configured: number; agent: number }> = {
  normal: { configured: 12, agent: 10 },
  large: { configured: 14, agent: 12 },
  'x-large': { configured: 16, agent: 14 },
};

/** Shared xterm and WebSocket orchestration for every interactive terminal surface. */
const useTerminalSurface = ({
  externalTarget,
  externalTerminalTarget,
  fontSizeMode = 'configured',
  onInput,
  onResize,
  onTitleChange,
  customKeyEventHandler,
  onData,
  onConnected,
  onSessionEnded,
}: IUseTerminalSurfaceOptions = {}) => {
  const { theme } = useTerminalTheme();
  const configFontSize = useConfigStore((state) => state.fontSize);
  const configLineHeight = useConfigStore((state) => state.lineHeight);
  const configLineHeightCustom = useConfigStore((state) => state.lineHeightCustom);
  const promptPrefix = useConfigStore((state) => state.promptPrefix);
  const writeRef = useRef<(data: Uint8Array) => void>(() => {});
  const sendStdinRef = useRef<(data: string) => void>(() => {});
  const sendResizeRef = useRef<(cols: number, rows: number) => void>(() => {});
  const configuredSizes = FONT_SIZES[configFontSize] ?? FONT_SIZES.normal;
  const fontSize = fontSizeMode === 'mobile' ? 11
    : fontSizeMode === 'default' ? undefined
      : configuredSizes[fontSizeMode];

  const websocket = useTerminalWebSocket({
    externalTarget,
    externalTerminalTarget,
    onData: (data) => {
      writeRef.current(data);
      onData?.(data);
    },
    onConnected,
    onSessionEnded,
  });
  const terminal = useTerminal({
    enablePromptCopy: true,
    promptPrefix,
    theme: theme.colors,
    fontSize,
    lineHeight: resolveLineHeight(configLineHeight, configLineHeightCustom),
    onInput: (data) => onInput ? onInput(data, sendStdinRef.current) : sendStdinRef.current(data),
    onResize: (cols, rows) => onResize ? onResize(cols, rows) : sendResizeRef.current(cols, rows),
    onTitleChange,
    customKeyEventHandler,
  });

  useEffect(() => {
    writeRef.current = terminal.write;
    sendStdinRef.current = websocket.sendStdin;
    sendResizeRef.current = websocket.sendResize;
  });

  return { ...terminal, ...websocket, theme };
};

export default useTerminalSurface;
