import { useEffect, useState } from 'react';
import useTerminal from '@/hooks/use-terminal';
import useTerminalTheme from '@/hooks/use-terminal-theme';
import { decodeMessage, encodeHeartbeat, MSG_STDOUT } from '@/lib/terminal-protocol';

export default function ReviewTerminal({ reviewId, windowId }: { reviewId: string; windowId: string }) {
  const { theme } = useTerminalTheme();
  const { terminalRef, write, isReady } = useTerminal({ readOnly: true, theme: theme.colors });
  const [status, setStatus] = useState('Connecting…');

  useEffect(() => {
    if (!isReady) return;
    let disposed = false;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = new URLSearchParams({ reviewId, windowId });
    const ws = new WebSocket(`${protocol}//${location.host}/api/ext-review-terminal?${query}`);
    ws.binaryType = 'arraybuffer';
    const heartbeat = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encodeHeartbeat());
    };
    const timer = setInterval(heartbeat, 25_000);
    ws.onopen = () => {
      setStatus('Live · read-only');
      heartbeat();
    };
    ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (disposed || !(event.data instanceof ArrayBuffer)) return;
      const { type, payload } = decodeMessage(event.data);
      if (type === MSG_STDOUT) write(payload);
    };
    ws.onerror = () => {
      if (!disposed) setStatus('Observation connection failed. Reopen the Review to retry.');
    };
    ws.onclose = (event) => {
      clearInterval(timer);
      if (disposed) return;
      setStatus(event.reason === 'Review deleted' ? 'This Review was deleted.'
        : event.code === 1011 ? 'The approved external targets are unavailable. Reopen the Review to check again.'
          : 'Observation disconnected. Reopen the Review to retry.');
    };
    return () => {
      disposed = true;
      clearInterval(timer);
      ws.close();
    };
  }, [isReady, reviewId, windowId, write]);

  return (
    <section aria-label={`Read-only terminal ${windowId}`}>
      <p role="status" className="my-3">{status}</p>
      <p className="mb-3 text-sm text-muted-foreground">Current external screen. Scroll to view its full dimensions. Input and paste are disabled.</p>
      <div className="max-h-[75vh] overflow-auto border rounded" onPasteCapture={(event) => { event.preventDefault(); event.stopPropagation(); }}>
        <div ref={terminalRef} style={{ width: 'max-content', minWidth: '100%', background: theme.colors.background }} />
      </div>
    </section>
  );
}
