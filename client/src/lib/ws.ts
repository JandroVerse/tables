import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";

// Define strongly typed message schemas
const BaseMessageSchema = z.object({
  type: z.enum(['client_update', 'server_update', 'error', 'ping', 'pong']),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
});

const ClientUpdateSchema = BaseMessageSchema.extend({
  type: z.literal('client_update'),
  data: z.object({
    tableId: z.number(),
    restaurantId: z.number(),
    status: z.enum(['active', 'inactive']),
    lastActivity: z.string().datetime(),
    currentRequests: z.array(z.object({
      id: z.number(),
      type: z.string(),
      status: z.string(),
      timestamp: z.string().datetime()
    }))
  })
});

const ServerUpdateSchema = BaseMessageSchema.extend({
  type: z.literal('server_update'),
  action: z.enum(['request_update', 'full_sync', 'error']),
  targetTableId: z.number().optional(),
  data: z.any()
});

type ClientMessage = z.infer<typeof ClientUpdateSchema>;
type ServerMessage = z.infer<typeof ServerUpdateSchema>;
type WebSocketMessage = ClientMessage | ServerMessage;

class WebSocketService {
  private ws: WebSocket | null = null;
  private messageQueue: WebSocketMessage[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private listeners = new Map<string, Set<(data: any) => void>>();
  private sessionId: string | null = null;

  constructor() {
    this.handleMessage = this.handleMessage.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.handleError = this.handleError.bind(this);
  }

  connect(sessionId: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket: Already connected');
      return;
    }

    this.sessionId = sessionId;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?sessionId=${sessionId}`;

    console.log('WebSocket: Connecting to', wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = this.handleOpen.bind(this);
    this.ws.onmessage = this.handleMessage;
    this.ws.onclose = this.handleClose;
    this.ws.onerror = this.handleError;
  }

  private handleOpen() {
    console.log('WebSocket: Connected');
    this.reconnectAttempts = 0;
    this.startPingInterval();
    this.flushMessageQueue();
    this.emit('connection', { status: 'connected' });
  }

  private handleMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data);
      console.log('WebSocket: Received message', message);

      if (message.type === 'ping') {
        this.send({ type: 'pong', timestamp: new Date().toISOString(), sessionId: this.sessionId! });
        return;
      }

      // Validate message against schema
      try {
        if (message.type === 'server_update') {
          ServerUpdateSchema.parse(message);
        } else if (message.type === 'client_update') {
          ClientUpdateSchema.parse(message);
        }
      } catch (error) {
        console.error('WebSocket: Invalid message format', error);
        return;
      }

      // Emit to all relevant listeners
      this.emit(message.type, message);
      if (message.action) {
        this.emit(`${message.type}:${message.action}`, message);
      }
    } catch (error) {
      console.error('WebSocket: Error processing message', error);
    }
  }

  private handleClose(event: CloseEvent) {
    console.log('WebSocket: Connection closed', event);
    this.stopPingInterval();
    this.emit('connection', { status: 'disconnected' });

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
      console.log(`WebSocket: Reconnecting in ${delay}ms`);
      this.reconnectAttempts++;
      setTimeout(() => this.connect(this.sessionId!), delay);
    }
  }

  private handleError(error: Event) {
    console.error('WebSocket: Error', error);
    this.emit('error', { error });
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

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.off(event, callback);
  }

  off(event: string, callback: (data: any) => void) {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('WebSocket: Error in listener', error);
      }
    });
  }

  disconnect() {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
    this.messageQueue = [];
    this.listeners.clear();
  }
}

export const wsService = new WebSocketService();