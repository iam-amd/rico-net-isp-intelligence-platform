/**
 * WebSocket connection manager.
 * Auto-reconnects every 3s on disconnect.
 */
export class WSConnection {
  private ws: WebSocket | null = null;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  onConnectChange?: (c: boolean) => void;
  private path: string;
  private onMessage: (data: any) => void;

  constructor(path: string, onMessage: (data: any) => void) {
    this.path = path;
    this.onMessage = onMessage;
    this.connect();
  }

  private connect() {
    const token = localStorage.getItem('noc_token');
    if (!token || !this.shouldReconnect) return;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}${this.path}`;

    try {
      this.ws = new WebSocket(url, ['rico-jwt', token]);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.onConnectChange?.(true);
    };

    this.ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch { /* ignore malformed */ }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.onConnectChange?.(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  close() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  get connected() {
    return this._connected;
  }
}
