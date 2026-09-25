import { useCallback, useEffect, useRef, useState } from 'react';
import useConfigStore from '@/hooks/use-config-store';
import useIsMobileDevice from '@/hooks/use-is-mobile-device';
import useTerminal from '@/hooks/use-terminal';
import useTerminalTheme from '@/hooks/use-terminal-theme';
import useTerminalWebSocket from '@/hooks/use-terminal-websocket';
import { resolveLineHeight } from '@/lib/terminal-line-height';
import { toCtrlChar } from '@/lib/terminal-keys';
import type { IExternalTerminalTarget } from '@/types/terminal';
import MobileTerminalToolbar from '@/components/features/mobile/mobile-terminal-toolbar';
import ConnectionStatus from '@/components/features/workspace/connection-status';
import TerminalContainer from '@/components/features/workspace/terminal-container';
import TerminalKeyBar from '@/components/features/workspace/terminal-key-bar';

type TExternalTerminalSurfaceProps =
  | { targetId: string; windowId: string; externalTerminalTarget?: never }
  | { targetId?: never; windowId?: never; externalTerminalTarget: IExternalTerminalTarget };

const TERMINAL_FONT_SIZES: Record<string, number> = {
  normal: 12,
  large: 14,
  'x-large': 16,
};

export default function ExternalTerminalSurface(props: TExternalTerminalSurfaceProps) {
  const externalTerminalTarget = props.externalTerminalTarget;
  const targetId = props.targetId;
  const externalServerId = externalTerminalTarget?.serverId;
  const externalSessionId = externalTerminalTarget?.sessionId;
  const windowId = externalTerminalTarget?.windowId ?? props.windowId!;
  const { theme } = useTerminalTheme();
  const configFontSize = useConfigStore((state) => state.fontSize);
  const configLineHeight = useConfigStore((state) => state.lineHeight);
  const configLineHeightCustom = useConfigStore((state) => state.lineHeightCustom);
  const keyBarMode = useConfigStore((state) => state.terminalKeyBar);
  const promptPrefix = useConfigStore((state) => state.promptPrefix);
  const isMobileDevice = useIsMobileDevice();
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [shiftArmed, setShiftArmed] = useState(false);
  const ctrlArmedRef = useRef(false);
  const shiftArmedRef = useRef(false);
  const writeRef = useRef<(data: Uint8Array) => void>(() => {});

  useEffect(() => { ctrlArmedRef.current = ctrlArmed; }, [ctrlArmed]);
  useEffect(() => { shiftArmedRef.current = shiftArmed; }, [shiftArmed]);

  const applyArmedModifier = useCallback((data: string): string => {
    if (data.length !== 1) return data;
    if (ctrlArmedRef.current) {
      setCtrlArmed(false);
      return toCtrlChar(data) ?? data;
    }
    if (shiftArmedRef.current) {
      setShiftArmed(false);
      return data.toUpperCase();
    }
    return data;
  }, []);

  const {
    status,
    retryCount,
    disconnectReason,
    externalTargetFailure,
    connect,
    disconnect,
    reconnect,
    sendStdin,
    sendWebStdin,
    sendResize,
  } = useTerminalWebSocket({
    externalTarget: targetId ? { id: targetId, windowId } : undefined,
    externalTerminalTarget,
    onData: (data) => writeRef.current(data),
  });
  const { terminalRef, write, fit, focus, isReady } = useTerminal({
    enablePromptCopy: true,
    promptPrefix,
    theme: theme.colors,
    fontSize: TERMINAL_FONT_SIZES[configFontSize] ?? TERMINAL_FONT_SIZES.normal,
    lineHeight: resolveLineHeight(configLineHeight, configLineHeightCustom),
    onInput: (data) => sendStdin(applyArmedModifier(data)),
    onResize: sendResize,
  });

  useEffect(() => { writeRef.current = write; }, [write]);

  useEffect(() => {
    if (!isReady) return;
    const { cols, rows } = fit();
    const connectionKey = externalServerId && externalSessionId
      ? `${externalServerId}:${externalSessionId}:${windowId}`
      : `${targetId}:${windowId}`;
    connect(connectionKey, cols, rows);
    focus();
    return disconnect;
  }, [
    isReady,
    targetId,
    windowId,
    externalServerId,
    externalSessionId,
    fit,
    focus,
    connect,
    disconnect,
  ]);

  const showKeyBar = !isMobileDevice && keyBarMode === 'always';

  return (
    <section
      aria-label={`External terminal ${windowId}`}
      className="relative flex h-[75vh] min-h-64 flex-col overflow-hidden rounded border"
      style={{ backgroundColor: theme.colors.background }}
    >
      <TerminalContainer ref={terminalRef} className="min-h-0 flex-1" />
      {showKeyBar && (
        <TerminalKeyBar
          sendStdin={sendStdin}
          ctrlActive={ctrlArmed}
          shiftActive={shiftArmed}
          setCtrlActive={setCtrlArmed}
          setShiftActive={setShiftArmed}
        />
      )}
      {isMobileDevice && status === 'connected' && (
        <MobileTerminalToolbar sendStdin={sendWebStdin} terminalConnected />
      )}
      {externalTargetFailure && (
        <p role="alert" className="absolute left-3 top-3 z-10 rounded-md bg-terminal-bg/90 px-3 py-2 text-sm text-muted-foreground">
          {externalTargetFailure}
        </p>
      )}
      <ConnectionStatus
        status={status}
        retryCount={retryCount}
        disconnectReason={disconnectReason}
        onReconnect={reconnect}
      />
    </section>
  );
}
