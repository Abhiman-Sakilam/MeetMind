import type { SignalingMessage } from '../types';
import { getStoredToken } from './api';

type MessageHandler = (msg: SignalingMessage) => void;

const WS_BASE =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

class SignalingSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private roomId: string | null = null;
  private userId: string | null = null;
  private pendingQueue: SignalingMessage[] = [];
  private joinPayload: SignalingMessage | null = null;
  private reconnectAttempt = 0;
  private static readonly MAX_RECONNECT_DELAY = 30_000;
  private static readonly BASE_RECONNECT_DELAY = 1_000;

  connect(roomId: string, userId: string) {
    this.roomId = roomId;
    this.userId = userId;
    this.doConnect();
  }

  private doConnect() {
    if (!this.roomId || !this.userId) return;

    // Backend requires a JWT on the WS handshake (?token=) and verifies room membership.
    const token = getStoredToken();
    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    const url = `${WS_BASE}/ws/${this.roomId}/${this.userId}${query}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[WS] Connected to signaling server');
      this.reconnectAttempt = 0;
      this.clearReconnect();
      if (this.joinPayload) {
        this.ws?.send(JSON.stringify(this.joinPayload));
      }
      this.flushQueue();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: SignalingMessage = JSON.parse(event.data);
        this.handlers.forEach((handler) => handler(msg));
      } catch {
        console.warn('[WS] Failed to parse message');
      }
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send(msg: SignalingMessage) {
    if (msg.type === 'join') {
      this.joinPayload = msg;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.pendingQueue.push(msg);
    }
  }

  private flushQueue() {
    while (this.pendingQueue.length > 0) {
      const msg = this.pendingQueue.shift()!;
      this.ws?.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  disconnect() {
    this.clearReconnect();
    this.pendingQueue = [];
    this.joinPayload = null;
    this.ws?.close();
    this.ws = null;
    this.roomId = null;
    this.userId = null;
  }

  private scheduleReconnect() {
    this.clearReconnect();
    const jitter = Math.random() * 500;
    const delay = Math.min(
      SignalingSocket.BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempt) + jitter,
      SignalingSocket.MAX_RECONNECT_DELAY,
    );
    this.reconnectAttempt++;
    console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => this.doConnect(), delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const signalingSocket = new SignalingSocket();
