import { useCallback, useEffect, useRef, useState } from 'react';
import useConfigStore from '@/hooks/use-config-store';
import useIsMobileDevice from '@/hooks/use-is-mobile-device';
import useTerminalSurface from '@/hooks/use-terminal-surface';
import { toCtrlChar } from '@/lib/terminal-keys';
import type { TTerminalTarget } from '@/types/terminal';
import MobileTerminalToolbar from '@/components/features/mobile/mobile-terminal-toolbar';
import ConnectionStatus from '@/components/features/workspace/connection-status';
import TerminalContainer from '@/components/features/workspace/terminal-container';
import TerminalKeyBar from '@/components/features/workspace/terminal-key-bar';
import { cn } from '@/lib/utils';

/** The standard interactive terminal composition for an explicit transport target. */
export default function TerminalSurface({
  target,
  className,
}: { target: TTerminalTarget; className?: string }) {
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
    onInput: (data, send) => send(applyArmedModifier(data)),
  });

  useEffect(() => {
    if (!isReady) return;
    const { cols, rows } = fit();
    connect(target, cols, rows);
    focus();
    return disconnect;
  }, [isReady, target, fit, focus, connect, disconnect]);

  const showKeyBar = !isMobileDevice && keyBarMode === 'always';
  const label = target.kind === 'external'
    ? `External terminal ${target.windowId}`
    : `Terminal ${target.sessionName}`;

  return (
    <section
      aria-label={label}
      className={cn('relative flex h-[75vh] min-h-64 flex-col overflow-hidden rounded border', className)}
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
