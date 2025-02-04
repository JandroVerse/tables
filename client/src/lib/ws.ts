import { z } from "zod";

// Define strongly typed message schemas
const BaseMessageSchema = z.object({
  type: z.enum(['ping', 'pong', 'server_update', 'error']),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
});

type WebSocketMessage = z.infer<typeof BaseMessageSchema>;

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageQueue: WebSocketMessage[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private sessionId: string | null = null;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
  }

  connect(sessionId: string): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.sessionId = sessionId;

    this.connectionPromise = new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log('WebSocket: Already connected');
        resolve();
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws?sessionId=${sessionId}`;

      console.log('WebSocket: Connecting to', wsUrl);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket: Connected');
        this.handleOpen();
        resolve();
      };

      this.ws.onmessage = this.handleMessage;
      this.ws.onclose = (event) => {
        this.handleClose(event);
        reject(new Error('WebSocket connection closed'));
      };
      this.ws.onerror = (error) => {
        this.handleError(error);
        reject(error);
      };
    }).finally(() => {
      this.connectionPromise = null;
    });

    return this.connectionPromise;
  }

  private handleOpen() {
    console.log('WebSocket: Connected');
    this.reconnectAttempts = 0;
    this.startPingInterval();
    this.flushMessageQueue();
  }

  private handleMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data);
      console.log('WebSocket: Received message', message);

      if (message.type === 'ping') {
        this.send({ 
          type: 'pong', 
          timestamp: new Date().toISOString(), 
          sessionId: this.sessionId! 
        });
      }
    } catch (error) {
      console.error('WebSocket: Error processing message', error);
    }
  }

  private handleClose(event: CloseEvent) {
    console.log('WebSocket: Connection closed', event);
    this.stopPingInterval();

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
      console.log(`WebSocket: Reconnecting in ${delay}ms`);
      this.reconnectAttempts++;
      setTimeout(() => {
        if (this.sessionId) {
          this.connect(this.sessionId);
        }
      }, delay);
    }
  }

  private handleError(error: Event) {
    console.error('WebSocket: Error', error);
  }

  private startPingInterval() {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      this.send({
        type: 'ping',
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId!
      });
    }, 30000);
  }

  private stopPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) this.send(message);
    }
  }

  send(message: WebSocketMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket: Queueing message', message);
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('WebSocket: Error sending message', error);
      this.messageQueue.push(message);
    }
  }

  disconnect() {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
    this.messageQueue = [];
  }
}

export const wsService = new WebSocketService();