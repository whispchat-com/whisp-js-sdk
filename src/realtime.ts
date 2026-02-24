import { Client as StompClient, IMessage, StompConfig } from '@stomp/stompjs';
import { TypedEventEmitter } from './events.js';
import { RealtimeEventMap, WhispEvent, AuthState } from './types.js';

// Map from API event type strings to our friendly event names
const EVENT_TYPE_MAP: Record<string, keyof RealtimeEventMap> = {
  SEND_MSG: 'message',
  EDIT_MSG: 'messageEdited',
  DELETE_MSG: 'messageDeleted',
  REPLY: 'reply',
  TYPING: 'typing',
  REACT: 'reaction',
  DELETE_REACT: 'reactionDeleted',
  READ_MSG: 'messageRead',
  USER_JOIN: 'userJoined',
  USER_LEAVE: 'userLeft',
  NEW_CHAT: 'chatCreated',
  DELETE_CHAT: 'chatDeleted',
};

export interface RealtimeConfig {
  baseUrl: string;
  getAuth: () => AuthState | null;
  getTicket: () => Promise<string>;
  refreshAuth: () => Promise<boolean>;
  webSocketImpl?: unknown;
}

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_RECONNECT_DELAY = 1_000;

export class WhispRealtime extends TypedEventEmitter<RealtimeEventMap> {
  private config: RealtimeConfig;
  private stompClient: StompClient | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;
  private _connected = false;

  constructor(config: RealtimeConfig) {
    super();
    this.config = config;
  }

  /** Whether the realtime connection is currently active. */
  get connected(): boolean {
    return this._connected;
  }

  /**
   * Connect to the Whisp realtime server.
   * Gets a WebSocket ticket and establishes the STOMP connection.
   */
  async connect(): Promise<void> {
    if (this._connected || this.stompClient?.active) {
      return;
    }

    this.intentionalDisconnect = false;
    this.reconnectAttempt = 0;
    await this.doConnect();
  }

  /**
   * Disconnect from the realtime server.
   */
  disconnect(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();

    if (this.stompClient) {
      this.stompClient.deactivate();
      this.stompClient = null;
    }

    if (this._connected) {
      this._connected = false;
      this.emit('disconnected', { reason: 'Manual disconnect', willReconnect: false });
    }
  }

  // ─── Send Actions ────────────────────────────────────────────────────────

  /** Send a message to a chat. */
  sendMessage(chatId: string, message: string): void {
    this.send({
      type: 'SEND_MSG',
      chatId,
      message,
      timeStamp: new Date().toISOString(),
    });
  }

  /** Edit an existing message. */
  editMessage(chatId: string, messageId: string, newMessage: string): void {
    this.send({
      type: 'EDIT_MSG',
      chatId,
      messageId,
      message: newMessage,
      timeStamp: new Date().toISOString(),
    });
  }

  /** Delete a message. */
  deleteMessage(chatId: string, messageId: string): void {
    this.send({
      type: 'DELETE_MSG',
      chatId,
      messageId,
    });
  }

  /** Reply to a message. */
  replyToMessage(chatId: string, messageId: string, message: string): void {
    this.send({
      type: 'REPLY',
      chatId,
      messageId,
      message,
      timeStamp: new Date().toISOString(),
    });
  }

  /** Send a typing indicator. */
  sendTyping(chatId: string): void {
    this.send({
      type: 'TYPING',
      chatId,
    });
  }

  /** Add a reaction to a message. */
  addReaction(chatId: string, messageId: string, reaction: string): void {
    this.send({
      type: 'REACT',
      chatId,
      messageId,
      reaction,
      timeStamp: new Date().toISOString(),
    });
  }

  /** Remove a reaction. */
  removeReaction(reactionId: string): void {
    this.send({
      type: 'DELETE_REACT',
      reactionId,
    });
  }

  /** Mark a message as read. */
  markAsRead(chatId: string, messageId: string): void {
    this.send({
      type: 'READ_MSG',
      chatId,
      messageId,
    });
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private send(payload: Record<string, unknown>): void {
    if (!this.stompClient?.active) {
      throw new Error('[Whisp] Cannot send: not connected. Call connect() first.');
    }

    const auth = this.config.getAuth();
    if (!auth) {
      throw new Error('[Whisp] Cannot send: not authenticated.');
    }

    this.stompClient.publish({
      destination: '/api/chat',
      body: JSON.stringify({
        ...payload,
        senderId: auth.userId,
      }),
    });
  }

  private async doConnect(): Promise<void> {
    const auth = this.config.getAuth();
    if (!auth) {
      throw new Error('[Whisp] Cannot connect: not authenticated. Call signIn() or setAuth() first.');
    }

    // Get a fresh ticket
    const ticket = await this.config.getTicket();

    // Build WebSocket URL
    const wsBase = this.config.baseUrl
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:')
      .replace(/\/+$/, '');
    const wsUrl = `${wsBase}/api/wsConnect?ticket=${ticket}`;

    return new Promise<void>((resolve, reject) => {
      const stompConfig: StompConfig = {
        brokerURL: wsUrl,
        connectHeaders: {
          Authorization: `Bearer ${auth.jwt}`,
        },
        // Silence STOMP debug logging by default
        debug: () => {},
        reconnectDelay: 0, // We handle reconnection ourselves

        onConnect: () => {
          this._connected = true;
          this.reconnectAttempt = 0;

          // Subscribe to the user's personal queue
          this.stompClient!.subscribe(
            `/user/${auth.userId}/queue/messages`,
            (stompMessage: IMessage) => {
              this.handleMessage(stompMessage);
            }
          );

          this.emit('connected');
          resolve();
        },

        onStompError: (frame) => {
          const errorMsg = frame.headers?.['message'] || 'STOMP error';
          this.emit('error', { error: new Error(errorMsg) });

          if (!this._connected) {
            reject(new Error(`[Whisp] STOMP connection error: ${errorMsg}`));
          }
        },

        onWebSocketClose: () => {
          const wasConnected = this._connected;
          this._connected = false;

          if (this.intentionalDisconnect) return;

          if (wasConnected) {
            this.emit('disconnected', { reason: 'Connection lost', willReconnect: true });
          }
          this.scheduleReconnect();
        },

        onWebSocketError: () => {
          // onWebSocketClose will fire after this, which handles reconnection
        },
      };

      // Use custom WebSocket implementation if provided (for Node.js)
      if (this.config.webSocketImpl) {
        stompConfig.webSocketFactory = () => {
          const WS = this.config.webSocketImpl as new (url: string) => WebSocket;
          return new WS(wsUrl);
        };
      }

      this.stompClient = new StompClient(stompConfig);
      this.stompClient.activate();
    });
  }

  private handleMessage(stompMessage: IMessage): void {
    try {
      const event: WhispEvent = JSON.parse(stompMessage.body);
      const eventName = EVENT_TYPE_MAP[event.type];

      if (eventName) {
        // The 'as never' is needed because TS can't narrow the union here,
        // but the mapping guarantees type correctness.
        this.emit(eventName, event as never);
      }
    } catch (err) {
      this.emit('error', { error: err });
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempt),
      MAX_RECONNECT_DELAY
    );
    this.reconnectAttempt++;

    this.emit('reconnecting', { attempt: this.reconnectAttempt });

    this.reconnectTimer = setTimeout(async () => {
      if (this.intentionalDisconnect) return;

      try {
        // JWT may have expired during downtime — refresh first
        const auth = this.config.getAuth();
        if (!auth) return;

        const refreshed = await this.config.refreshAuth();
        if (!refreshed && !this.config.getAuth()) {
          this.emit('disconnected', { reason: 'Auth expired', willReconnect: false });
          return;
        }

        await this.doConnect();
      } catch {
        // doConnect failed, schedule another attempt
        if (!this.intentionalDisconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
