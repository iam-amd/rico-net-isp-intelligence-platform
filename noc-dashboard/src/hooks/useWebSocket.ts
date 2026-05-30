import { useEffect, useRef, useState } from 'react';
import { WSConnection } from '../api/ws';

/** Generic WebSocket hook. Returns { connected } and fires onMessage on each JSON message. */
export function useWebSocket(path: string, onMessage: (data: any) => void) {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onMessage);
  cbRef.current = onMessage; // Keep callback fresh without re-subscribing

  useEffect(() => {
    const conn = new WSConnection(path, (data) => cbRef.current(data));
    conn.onConnectChange = setConnected;
    return () => conn.close();
  }, [path]);

  return { connected };
}
