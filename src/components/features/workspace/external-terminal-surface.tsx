import { useCallback, useEffect, useRef, useState } from 'react';
import useConfigStore from '@/hooks/use-config-store';
import useIsMobileDevice from '@/hooks/use-is-mobile-device';
import useTerminalSurface from '@/hooks/use-terminal-surface';
import { toCtrlChar } from '@/lib/terminal-keys';
import type { IExternalTerminalTarget } from '@/types/terminal';
import MobileTerminalToolbar from '@/components/features/mobile/mobile-terminal-toolbar';
import ConnectionStatus from '@/components/features/workspace/connection-status';
import TerminalContainer from '@/components/features/workspace/terminal-container';
import TerminalKeyBar from '@/components/features/workspace/terminal-key-bar';

type TExternalTerminalSurfaceProps =
  | { targetId: string; windowId: string; externalTerminalTarget?: never }
  | { targetId?: never; windowId?: never; externalTerminalTarget: IExternalTerminalTarget };

export default function ExternalTerminalSurface(props: TExternalTerminalSurfaceProps) {
  const externalTerminalTarget = props.externalTerminalTarget;
  const targetId = props.targetId;
  const externalServerId = externalTerminalTarget?.serverId;
  const externalSessionId = externalTerminalTarget?.sessionId;
  const windowId = externalTerminalTarget?.windowId ?? props.windowId!;
  const keyBarMode = useConfigStore((state) => state.terminalKeyBar);
  const isMobileDevice = useIsMobileDevice();
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [shiftArmed, setShiftArmed] = useState(false);
  const ctrlArmedRef = useRef(false);
  const shiftArmedRef = useRef(false);

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
    terminalRef,
    fit,
    focus,
    isReady,
    theme,
  } = useTerminalSurface({
    externalTarget: targetId ? { id: targetId, windowId } : undefined,
    externalTerminalTarget,
    onInput: (data, send) => send(applyArmedModifier(data)),
  });

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
