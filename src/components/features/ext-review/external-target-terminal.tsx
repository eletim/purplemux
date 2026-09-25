import { useEffect } from 'react';
import useTerminal from '@/hooks/use-terminal';
import useTerminalWebSocket from '@/hooks/use-terminal-websocket';
import useTerminalTheme from '@/hooks/use-terminal-theme';
import type { IExternalTerminalTarget } from '@/types/terminal';

type TExternalTargetTerminalProps =
  | { targetId: string; windowId: string; externalTerminalTarget?: never }
  | { targetId?: never; windowId?: never; externalTerminalTarget: IExternalTerminalTarget };

export default function ExternalTargetTerminal(props: TExternalTargetTerminalProps) {
  const externalTerminalTarget = props.externalTerminalTarget;
  const targetId = props.targetId;
  const windowId = externalTerminalTarget?.windowId ?? props.windowId!;
  const { theme } = useTerminalTheme();
  const { status, disconnectReason, externalTargetFailure, connect, disconnect, sendStdin, sendResize } = useTerminalWebSocket({
    externalTarget: targetId ? { id: targetId, windowId } : undefined,
    externalTerminalTarget,
    onData: (data) => write(data),
  });
  const { terminalRef, write, fit, isReady } = useTerminal({
    theme: theme.colors,
    onInput: sendStdin,
    onResize: sendResize,
  });

  useEffect(() => {
    if (!isReady) return;
    const { cols, rows } = fit();
    const connectionKey = externalTerminalTarget
      ? `${externalTerminalTarget.serverId}:${externalTerminalTarget.sessionId}:${windowId}`
      : `${targetId}:${windowId}`;
    connect(connectionKey, cols, rows);
    return disconnect;
  }, [isReady, targetId, windowId, externalTerminalTarget, fit, connect, disconnect]);

  return (
    <section aria-label={`External terminal ${windowId}`}>
      <p role="status" className="my-3">{externalTargetFailure || (disconnectReason ? 'External target unavailable' : status)}</p>
      <div className="h-[75vh] min-h-64 border rounded overflow-hidden" ref={terminalRef} />
    </section>
  );
}
