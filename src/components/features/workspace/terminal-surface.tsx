import { useCallback, useEffect, useRef, useState, type ComponentProps, type RefCallback } from 'react';
import useConfigStore from '@/hooks/use-config-store';
import useIsMobileDevice from '@/hooks/use-is-mobile-device';
import useTerminalSurface from '@/hooks/use-terminal-surface';
import { toCtrlChar } from '@/lib/terminal-keys';
import type { IExternalTerminalTarget } from '@/types/terminal';
import MobileTerminalToolbar from '@/components/features/mobile/mobile-terminal-toolbar';
import ConnectionStatus from '@/components/features/workspace/connection-status';
import TerminalContainer from '@/components/features/workspace/terminal-container';
import TerminalKeyBar from '@/components/features/workspace/terminal-key-bar';
import { cn } from '@/lib/utils';

interface ITerminalSurfaceProps {
  terminalRef: RefCallback<HTMLDivElement>;
  containerClassName?: string;
  minHeight?: number;
  keyBar?: ComponentProps<typeof TerminalKeyBar>;
  mobileToolbar?: ComponentProps<typeof MobileTerminalToolbar>;
}

/** Shared terminal viewport and input controls for managed and external targets. */
export default function TerminalSurface({
  terminalRef,
  containerClassName,
  minHeight,
  keyBar,
  mobileToolbar,
}: ITerminalSurfaceProps) {
  return (
    <>
      <TerminalContainer ref={terminalRef} minHeight={minHeight} className={containerClassName} />
      {keyBar && <TerminalKeyBar {...keyBar} />}
      {mobileToolbar && <MobileTerminalToolbar {...mobileToolbar} />}
    </>
  );
}

/** Connect the shared terminal surface to one exact external tmux window. */
export function ExternalTerminalConnection({
  target,
  className,
}: { target: IExternalTerminalTarget; className?: string }) {
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
    connect({ kind: 'external', ...target }, cols, rows);
    focus();
    return disconnect;
  }, [isReady, target, fit, focus, connect, disconnect]);

  const showKeyBar = !isMobileDevice && keyBarMode === 'always';
  return (
    <section
      aria-label={`External terminal ${target.windowId}`}
      className={cn('relative flex h-[75vh] min-h-64 flex-col overflow-hidden rounded border', className)}
      style={{ backgroundColor: theme.colors.background }}
    >
      <TerminalSurface
        terminalRef={terminalRef}
        containerClassName="min-h-0 flex-1"
        keyBar={showKeyBar ? {
          sendStdin,
          ctrlActive: ctrlArmed,
          shiftActive: shiftArmed,
          setCtrlActive: setCtrlArmed,
          setShiftActive: setShiftArmed,
        } : undefined}
        mobileToolbar={isMobileDevice && status === 'connected'
          ? { sendStdin: sendWebStdin, terminalConnected: true }
          : undefined}
      />
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
