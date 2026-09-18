import { useEffect } from 'react';
import useTerminal from '@/hooks/use-terminal';
import useTerminalWebSocket from '@/hooks/use-terminal-websocket';
import useTerminalTheme from '@/hooks/use-terminal-theme';

export default function ExternalTargetTerminal({ targetId, windowId }: { targetId: string; windowId: string }) {
  const { theme } = useTerminalTheme();
  const { status, disconnectReason, externalTargetFailure, connect, disconnect, sendStdin, sendResize } = useTerminalWebSocket({
    externalTarget: { id: targetId, windowId },
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
    connect(`${targetId}:${windowId}`, cols, rows);
    return disconnect;
  }, [isReady, targetId, windowId, fit, connect, disconnect]);

  return (
    <section aria-label={`External terminal ${windowId}`}>
      <p role="status" className="my-3">{externalTargetFailure || (disconnectReason ? 'External target unavailable' : status)}</p>
      <div className="h-[75vh] min-h-64 border rounded overflow-hidden" ref={terminalRef} />
    </section>
  );
}
