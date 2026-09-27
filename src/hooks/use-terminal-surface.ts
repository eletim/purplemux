import { useCallback, useEffect, useRef, useState } from 'react';
import useConfigStore from '@/hooks/use-config-store';
import useTerminal from '@/hooks/use-terminal';
import useTerminalTheme from '@/hooks/use-terminal-theme';
import useTerminalWebSocket from '@/hooks/use-terminal-websocket';
import { toCtrlChar } from '@/lib/terminal-keys';
import { resolveLineHeight } from '@/lib/terminal-line-height';
import type { TTerminalTarget } from '@/types/terminal';

type TFontSizeMode = 'configured' | 'agent' | 'mobile' | 'default';

interface IUseTerminalSurfaceOptions {
  fontSizeMode?: TFontSizeMode;
  onResize?: (cols: number, rows: number) => void;
  onTitleChange?: (title: string) => void;
  customKeyEventHandler?: (event: KeyboardEvent) => boolean;
  onData?: (data: Uint8Array) => void;
  onConnected?: () => void;
  onSessionEnded?: () => void;
}

interface ITerminalConnectionPolicy {
  initialSize?: 'fit' | 'defer' | ((size: { cols: number; rows: number }) => { cols: number; rows: number });
  focus?: 'terminal' | 'preserve';
}

const FONT_SIZES: Record<string, { configured: number; agent: number }> = {
  normal: { configured: 12, agent: 10 },
  large: { configured: 14, agent: 12 },
  'x-large': { configured: 16, agent: 14 },
};

/** Shared xterm and WebSocket orchestration for every interactive terminal surface. */
const useTerminalSurface = ({
  fontSizeMode = 'configured',
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
  const ctrlArmedRef = useRef(false);
  const shiftArmedRef = useRef(false);
  const [ctrlArmed, setCtrlArmedState] = useState(false);
  const [shiftArmed, setShiftArmedState] = useState(false);
  const configuredSizes = FONT_SIZES[configFontSize] ?? FONT_SIZES.normal;
  const fontSize = fontSizeMode === 'mobile' ? 11
    : fontSizeMode === 'default' ? undefined
      : configuredSizes[fontSizeMode];

  const setCtrlArmed = useCallback((armed: boolean) => {
    ctrlArmedRef.current = armed;
    setCtrlArmedState(armed);
  }, []);
  const setShiftArmed = useCallback((armed: boolean) => {
    shiftArmedRef.current = armed;
    setShiftArmedState(armed);
  }, []);
  const sendTerminalInput = useCallback((data: string) => {
    if (data.length === 1 && ctrlArmedRef.current) {
      setCtrlArmed(false);
      sendStdinRef.current(toCtrlChar(data) ?? data);
      return;
    }
    if (data.length === 1 && shiftArmedRef.current) {
      setShiftArmed(false);
      sendStdinRef.current(data.toUpperCase());
      return;
    }
    sendStdinRef.current(data);
  }, [setCtrlArmed, setShiftArmed]);

  const websocket = useTerminalWebSocket({
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
    onInput: sendTerminalInput,
    onResize: (cols, rows) => onResize ? onResize(cols, rows) : sendResizeRef.current(cols, rows),
    onTitleChange,
    customKeyEventHandler,
  });
  const { connect: connectWebSocket } = websocket;
  const { fit: fitTerminal, focus: focusTerminal } = terminal;

  useEffect(() => {
    writeRef.current = terminal.write;
    sendStdinRef.current = websocket.sendStdin;
    sendResizeRef.current = websocket.sendResize;
  });

  const connectTarget = useCallback((
    target: TTerminalTarget,
    policy: ITerminalConnectionPolicy = {},
  ) => {
    const initialSizePolicy = policy.initialSize ?? 'fit';
    const measuredSize = initialSizePolicy === 'defer' ? undefined : fitTerminal();
    const initialSize = typeof initialSizePolicy === 'function' && measuredSize
      ? initialSizePolicy(measuredSize)
      : measuredSize;
    connectWebSocket(target, initialSize?.cols, initialSize?.rows);
    if ((policy.focus ?? 'preserve') === 'terminal') focusTerminal();
  }, [connectWebSocket, fitTerminal, focusTerminal]);

  return {
    ...terminal,
    ...websocket,
    connectTarget,
    sendMobileInput: websocket.sendWebStdin,
    modifierKeys: {
      ctrlActive: ctrlArmed,
      shiftActive: shiftArmed,
      setCtrlActive: setCtrlArmed,
      setShiftActive: setShiftArmed,
    },
    theme,
  };
};

export default useTerminalSurface;
