import { useEffect, type ComponentProps, type RefCallback } from 'react';
import useConfigStore from '@/hooks/use-config-store';
import useIsMobileDevice from '@/hooks/use-is-mobile-device';
import useTerminalSurface from '@/hooks/use-terminal-surface';
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
  const { serverId, sessionId, windowId } = target;
  const keyBarMode = useConfigStore((state) => state.terminalKeyBar);
  const isMobileDevice = useIsMobileDevice();
  const {
    status,
    retryCount,
    disconnectReason,
    externalTargetFailure,
    connectTarget,
    disconnect,
    reconnect,
    sendStdin,
    sendMobileInput,
    modifierKeys,
    terminalRef,
    isReady,
    theme,
  } = useTerminalSurface();

  useEffect(() => {
    if (!isReady) return;
    connectTarget(
      { kind: 'external', serverId, sessionId, windowId },
      { initialSize: 'fit', focus: 'terminal' },
    );
    return disconnect;
  }, [isReady, serverId, sessionId, windowId, connectTarget, disconnect]);

  const showKeyBar = !isMobileDevice && keyBarMode === 'always';
  return (
    <section
      aria-label={`External terminal ${windowId}`}
      className={cn('relative flex h-[75vh] min-h-64 flex-col overflow-hidden rounded border', className)}
      style={{ backgroundColor: theme.colors.background }}
    >
      <TerminalSurface
        terminalRef={terminalRef}
        containerClassName="min-h-0 flex-1"
        keyBar={showKeyBar ? {
          sendStdin,
          ...modifierKeys,
        } : undefined}
        mobileToolbar={isMobileDevice && status === 'connected'
          ? { sendStdin: sendMobileInput, terminalConnected: true }
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
