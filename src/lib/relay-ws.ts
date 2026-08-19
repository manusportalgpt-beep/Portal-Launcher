type WsMsg = { type: string; [key: string]: unknown };
type Handler = (msg: WsMsg) => void;

class RelayWebSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private userId = '';
  private relayUrl = '';
  private intentionalClose = false;
  private reconnectDelay = 2000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  public connected = false;
  public onConnectionChange: ((v: boolean) => void) | null = null;

  connect(relayUrl: string, userId: string): void {
    if (!relayUrl || !userId) return;
    this.relayUrl = relayUrl;
    this.userId = userId;
    this.intentionalClose = false;
    this._open();
  }

  private _open(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    try {
      const wsUrl = this.relayUrl.replace(/^https/, 'wss').replace(/^http/, 'ws') + `/ws?userId=${encodeURIComponent(this.userId)}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectDelay = 2000;
        this.onConnectionChange?.(true);
        this.send({ type: 'status', status: 'online' });
        this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25000);
      };

      this.ws.onmessage = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data as string) as WsMsg;
          for (const h of this.handlers) h(msg);
        } catch { /* ignore bad JSON */ }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.onConnectionChange?.(false);
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
        if (!this.intentionalClose) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
            this._open();
          }, this.reconnectDelay);
        }
      };

      this.ws.onerror = () => this.ws?.close();
    } catch (e) {
      console.warn('[RelayWS] connect error', e);
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; }
    this.connected = false;
  }

  send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  subscribe(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

export const relayWS = new RelayWebSocket();
