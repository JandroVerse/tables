import { z } from "zod";

type ServiceRequestListener = (data: any) => void;

interface WebSocketMessage {
  type: 'new_request' | 'update_request' | 'connection_status';
  tableId?: number;
  restaurantId?: number;
  request?: any;
  status?: 'connected' | 'disconnected' | 'reconnecting';
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

    connect(forceSessionId?: string) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        console.log('WebSocket: Already connected');
        return;
      }

      // Update session ID if provided
      if (forceSessionId) {
        console.log('WebSocket: Using provided session ID:', forceSessionId);
        this.sessionId = forceSessionId;
        localStorage.setItem('sessionId', forceSessionId);
      }

      // If no session ID provided, try to get from localStorage
      if (!this.sessionId) {
        this.sessionId = localStorage.getItem('sessionId');
      }

      if (!this.sessionId) {
        console.log('WebSocket: No session ID available');
        return;
      }

      // Clear any existing connection timer
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }

      console.log('WebSocket: Connecting with session ID:', this.sessionId);

      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = new URL(`${protocol}//${host}/ws`);
        wsUrl.searchParams.append('sessionId', this.sessionId);

        this.ws = new WebSocket(wsUrl.toString());

        this.ws.onopen = () => {
          console.log('WebSocket: Connection established');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.notifyListeners({
            type: 'connection_status',
            status: 'connected'
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

      if (this.reconnectAttempts < this.maxReconnectAttempts && this.sessionId) {
        const delay = this.reconnectDelay * Math.min(Math.pow(2, this.reconnectAttempts), 10);
        console.log(`WebSocket: Attempting to reconnect (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}) in ${delay}ms`);

        this.notifyListeners({
          type: 'connection_status',
          status: 'reconnecting'
        });

        this.reconnectAttempts++;
        this.connectionTimer = setTimeout(() => this.connect(this.sessionId!), delay);
      } else {
        console.error('WebSocket: Max reconnection attempts reached or no session ID available');
      }
    }

    send(message: WebSocketMessage) {
      if (!this.sessionId || !message.tableId || !message.restaurantId) {
        console.error('WebSocket: Cannot send message - missing required data:', { 
          sessionId: this.sessionId,
          tableId: message.tableId,
          restaurantId: message.restaurantId
        });
        return;
      }

      if (this.ws?.readyState === WebSocket.OPEN) {
        const messageWithSession = {
          ...message,
          sessionId: this.sessionId
        };
        console.log('WebSocket: Sending message:', messageWithSession);
        this.ws.send(JSON.stringify(messageWithSession));
      } else {
        console.error('WebSocket: Cannot send message - connection not open');
        this.connect(this.sessionId);
      }
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