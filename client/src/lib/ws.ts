import { z } from "zod";

type ServiceRequestListener = (data: any) => void;

interface WebSocketMessage {
  type: 'new_request' | 'update_request' | 'connection_status';
  tableId?: number;
  restaurantId?: number;
  request?: any;
  status?: 'connected' | 'disconnected' | 'reconnecting';
  clientType?: 'customer' | 'admin';
  broadcast?: boolean;
}

class WebSocketService {
    private ws: WebSocket | null = null;
    private listeners: ServiceRequestListener[] = [];
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectDelay = 2000;
    private isConnected = false;
    private connectionTimer: NodeJS.Timeout | null = null;
    private sessionId: string | null = null;
    private clientType: 'customer' | 'admin' = 'customer';
    private currentRestaurantId: number | null = null;

    connect(forceSessionId?: string, type: 'customer' | 'admin' = 'customer', restaurantId?: number) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log('WebSocket: Already connected');
        return;
      }

      // Update session ID if provided
      if (forceSessionId) {
        console.log('WebSocket: Using provided session ID:', forceSessionId);
        this.sessionId = forceSessionId;
      }

      // Store client type and restaurant ID
      this.clientType = type;
      this.currentRestaurantId = restaurantId || null;

      // Clear any existing connection timer
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }

      console.log('WebSocket: Connecting with session ID:', this.sessionId, 'type:', type, 'restaurantId:', restaurantId);

      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = new URL(`${protocol}//${host}/ws`);
        wsUrl.searchParams.append('sessionId', this.sessionId || 'none');
        wsUrl.searchParams.append('clientType', this.clientType);
        if (restaurantId) {
          wsUrl.searchParams.append('restaurantId', restaurantId.toString());
        }

        console.log('WebSocket: Connecting to URL:', wsUrl.toString());
        this.ws = new WebSocket(wsUrl.toString());

        this.ws.onopen = () => {
          console.log('WebSocket: Connection established');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.notifyListeners({
            type: 'connection_status',
            status: 'connected',
            restaurantId: this.currentRestaurantId
          });
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('WebSocket: Received message:', data);
            this.listeners.forEach(listener => listener(data));
          } catch (error) {
            console.error('WebSocket: Error parsing message:', error);
          }
        };

        this.ws.onclose = () => {
          console.log('WebSocket: Connection closed');
          this.isConnected = false;
          this.ws = null;
          this.handleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket: Connection error:', error);
          if (this.ws) {
            this.ws.close();
          }
        };
      } catch (error) {
        console.error('WebSocket: Failed to create connection:', error);
        this.handleReconnect();
      }
    }

    private handleReconnect() {
      this.notifyListeners({
        type: 'connection_status',
        status: 'disconnected'
      });

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = this.reconnectDelay * Math.min(Math.pow(2, this.reconnectAttempts), 10);
        console.log(`WebSocket: Attempting to reconnect (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}) in ${delay}ms`);

        this.notifyListeners({
          type: 'connection_status',
          status: 'reconnecting'
        });

        this.reconnectAttempts++;
        this.connectionTimer = setTimeout(
          () => this.connect(this.sessionId!, this.clientType, this.currentRestaurantId || undefined),
          delay
        );
      } else {
        console.error('WebSocket: Max reconnection attempts reached');
      }
    }

    send(message: WebSocketMessage) {
      if (!this.ws?.readyState === WebSocket.OPEN) {
        console.error('WebSocket: Cannot send message - connection not open');
        this.connect(this.sessionId, this.clientType, this.currentRestaurantId || undefined);
        return;
      }

      const messageWithSession = {
        ...message,
        sessionId: this.sessionId,
        clientType: this.clientType,
        restaurantId: this.currentRestaurantId,
        broadcast: message.broadcast ?? true
      };

      console.log('WebSocket: Sending message:', messageWithSession);
      this.ws.send(JSON.stringify(messageWithSession));
    }

    subscribe(listener: ServiceRequestListener) {
      console.log('WebSocket: New listener subscribed');
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter(l => l !== listener);
        console.log('WebSocket: Listener unsubscribed');
      };
    }

    disconnect() {
      console.log('WebSocket: Disconnecting...');
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.isConnected = false;
      this.reconnectAttempts = 0;
      this.sessionId = null;
      this.currentRestaurantId = null;
      this.notifyListeners({
        type: 'connection_status',
        status: 'disconnected'
      });
    }

    private notifyListeners(message: WebSocketMessage) {
      this.listeners.forEach(listener => listener(message));
    }
}

export const wsService = new WebSocketService();