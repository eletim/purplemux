import { useCallback, useEffect, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { IExternalTerminalTarget, TConnectionStatus, TDisconnectReason } from '@/types/terminal';
import {
  MSG_STDOUT,
  MSG_HEARTBEAT,
  encodeStdin,
  encodeWebStdin,
  encodeResize,
  encodeHeartbeat,
  decodeMessage,
} from '@/lib/terminal-protocol';
import { shouldPromptMobileReloadRecovery } from '@/lib/ws-reload-recovery';

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
const MAX_RETRIES = 5;
const HEARTBEAT_INTERVAL = 30_000;
const CLIENT_ID_PREFIX = 'pt-ws-cid-';

const getOrCreateClientId = (sessionName: string): string => {
  const key = `${CLIENT_ID_PREFIX}${sessionName}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const id = nanoid();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return nanoid();
  }
};

interface IUseTerminalWebSocketOptions {
  externalTarget?: { id: string; windowId: string };
  externalTerminalTarget?: IExternalTerminalTarget;
  onData?: (data: Uint8Array) => void;
  onConnected?: () => void;
  onSessionEnded?: () => void;
}

const useTerminalWebSocket = ({
  externalTarget,
  externalTerminalTarget,
  onData,
  onConnected,
  onSessionEnded,
}: IUseTerminalWebSocketOptions = {}) => {
  const externalTargetId = externalTarget?.id;
  const externalWindowId = externalTarget?.windowId;
  const externalServerId = externalTerminalTarget?.serverId;
  const externalSessionId = externalTerminalTarget?.sessionId;
  const externalServerWindowId = externalTerminalTarget?.windowId;
  const [status, setStatus] = useState<TConnectionStatus>('disconnected');
  const [retryCount, setRetryCount] = useState(0);
  const [disconnectReason, setDisconnectReason] =
    useState<TDisconnectReason>(null);
  const [externalTargetFailure, setExternalTargetFailure] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const sessionNameRef = useRef('');
  const connectIdRef = useRef(0);
  const initialSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const callbacksRef = useRef({ onData, onConnected, onSessionEnded });
  const doConnectRef = useRef<(sessionName: string, connectId: number) => void>(() => {});

  useEffect(() => {
    callbacksRef.current = { onData, onConnected, onSessionEnded };
  }, [onData, onConnected, onSessionEnded]);

  const clearTimers = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const doConnect = useCallback(
    (sessionName: string, connectId: number) => {
      clearTimers();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      setDisconnectReason(null);
      setExternalTargetFailure(null);
      setStatus(retryCountRef.current > 0 ? 'reconnecting' : 'connecting');

      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const connectionKey = externalServerId && externalSessionId && externalServerWindowId
        ? `external-server:${externalServerId}:${externalSessionId}:${externalServerWindowId}`
        : externalTargetId && externalWindowId
          ? `external-target:${externalTargetId}:${externalWindowId}`
          : sessionName;
      const clientId = getOrCreateClientId(connectionKey);
      const size = initialSizeRef.current;
      const sizeParams = size ? `&cols=${size.cols}&rows=${size.rows}` : '';
      const targetParams = externalServerId && externalSessionId && externalServerWindowId
        ? `externalServerId=${encodeURIComponent(externalServerId)}&sessionId=${encodeURIComponent(externalSessionId)}&windowId=${encodeURIComponent(externalServerWindowId)}`
        : externalTargetId && externalWindowId
          ? `externalTargetId=${encodeURIComponent(externalTargetId)}&windowId=${encodeURIComponent(externalWindowId)}`
          : `session=${encodeURIComponent(sessionName)}`;
      const ws = new WebSocket(
        `${protocol}//${location.host}/api/terminal?clientId=${clientId}&${targetParams}${sizeParams}`,
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (connectIdRef.current !== connectId) return;
        setStatus('connected');
        retryCountRef.current = 0;
        setRetryCount(0);
        callbacksRef.current.onConnected?.();

        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(encodeHeartbeat());
          }
        }, HEARTBEAT_INTERVAL);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (connectIdRef.current !== connectId) return;
        const { type, payload } = decodeMessage(event.data as ArrayBuffer);

        switch (type) {
          case MSG_STDOUT:
            callbacksRef.current.onData?.(payload);
            break;
          case MSG_HEARTBEAT:
            break;
        }
      };

      ws.onclose = (event: CloseEvent) => {
        if (connectIdRef.current !== connectId) return;
        clearTimers();
        wsRef.current = null;

        if (event.code === 1000) {
          setStatus('session-ended');
          callbacksRef.current.onSessionEnded?.();
          return;
        }

        if ((externalTargetId || externalServerId) && event.code === 1008) {
          setExternalTargetFailure(event.reason || 'External target rejected');
          sessionNameRef.current = '';
          setStatus('disconnected');
          return;
        }

        if (event.code === 1011) {
          setDisconnectReason('session-not-found');
          setStatus('disconnected');
          return;
        }

        if (event.code === 1013) {
          setDisconnectReason('max-connections');
          setStatus('disconnected');
          return;
        }

        if (retryCountRef.current < MAX_RETRIES) {
          const delay = RECONNECT_DELAYS[retryCountRef.current] ?? 16000;
          retryCountRef.current++;
          setRetryCount(retryCountRef.current);
          setStatus('reconnecting');
          retryTimerRef.current = setTimeout(() => {
            doConnectRef.current(sessionNameRef.current, connectId);
          }, delay);
        } else {
          if (shouldPromptMobileReloadRecovery()) {
            setDisconnectReason('reconnect-exhausted');
          }
          setStatus('disconnected');
        }
      };

      ws.onerror = () => {
        console.log('[terminal-ws] connection error');
      };
    },
    [clearTimers, externalServerId, externalSessionId, externalServerWindowId,
      externalTargetId, externalWindowId],
  );

  useEffect(() => {
    doConnectRef.current = doConnect;
  }, [doConnect]);

  const connect = useCallback(
    (sessionName: string, cols?: number, rows?: number) => {
      sessionNameRef.current = sessionName;
      initialSizeRef.current = cols && rows ? { cols, rows } : null;
      retryCountRef.current = 0;
      setRetryCount(0);
      connectIdRef.current++;
      doConnect(sessionName, connectIdRef.current);
    },
    [doConnect],
  );

  const disconnect = useCallback(() => {
    connectIdRef.current++;
    clearTimers();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    sessionNameRef.current = '';
    setStatus('disconnected');
  }, [clearTimers]);

  const reconnect = useCallback(() => {
    if (!sessionNameRef.current) return;
    retryCountRef.current = 0;
    setRetryCount(0);
    connectIdRef.current++;
    doConnect(sessionNameRef.current, connectIdRef.current);
  }, [doConnect]);

  const sendStdin = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encodeStdin(data));
    }
  }, []);

  const sendWebStdin = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encodeWebStdin(data));
    }
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encodeResize(cols, rows));
    }
  }, []);

  useEffect(() => {
    return () => {
      connectIdRef.current++; // eslint-disable-line react-hooks/exhaustive-deps -- intentional mutation to invalidate pending callbacks
      clearTimers();
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (!sessionNameRef.current) return;
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      retryCountRef.current = 0;
      setRetryCount(0);
      connectIdRef.current++;
      doConnectRef.current(sessionNameRef.current, connectIdRef.current);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return {
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
  };
};

export default useTerminalWebSocket;
