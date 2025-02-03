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
    // If a session ID is provided, use it immediately
    if (forceSessionId) {
      this.sessionId = forceSessionId;
      console.log('WebSocket: Using provided session ID:', forceSessionId);
    } else {
      this.sessionId = localStorage.getItem('sessionId');
    }

    // Cancel any existing connection attempt
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }

    // Check if already connected
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket: Already connected');
      return;
    }

    if (!this.sessionId) {
      console.log('WebSocket: No session ID available, retrying in 2 seconds');
      this.connectionTimer = setTimeout(() => this.connect(), 2000);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = new URL(`${protocol}//${host}/ws`);
    wsUrl.searchParams.append('sessionId', this.sessionId);

    console.log('WebSocket: Attempting to connect with session ID:', this.sessionId);

    try {
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
          console.log('WebSocket: Received message', data);
          this.listeners.forEach(listener => listener(data));
        } catch (error) {
          console.error('WebSocket: Error parsing message', error);
        }
      };

      this.ws.onclose = () => {
        if (this.isConnected) {
          console.log('WebSocket: Connection closed, attempting to reconnect');
          this.isConnected = false;
          this.ws = null;
          this.handleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket: Error occurred', error);
        if (this.ws) {
          this.ws.close();
        }
      };
    } catch (error) {
      console.error('WebSocket: Failed to create connection', error);
      this.handleReconnect();
    }
  }

  private handleReconnect() {
    this.notifyListeners({
      type: 'connection_status',
      status: 'disconnected'
    });

    // Try to get a fresh session ID
    const freshSessionId = localStorage.getItem('sessionId');
    if (freshSessionId !== this.sessionId) {
      this.sessionId = freshSessionId;
      console.log('WebSocket: Found new session ID during reconnect:', freshSessionId);
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.min(Math.pow(2, this.reconnectAttempts), 10);
      console.log(`WebSocket: Attempting to reconnect (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}) in ${delay}ms`);

      this.notifyListeners({
        type: 'connection_status',
        status: 'reconnecting'
      });

      this.reconnectAttempts++;
      this.connectionTimer = setTimeout(() => this.connect(), delay);
    } else {
      console.error('WebSocket: Max reconnection attempts reached');
    }
  }

  send(message: WebSocketMessage) {
    if (!message.tableId || !message.restaurantId) {
      console.error('WebSocket: Invalid message - missing required parameters', message);
      return;
    }

    if (!this.sessionId) {
      // Try to get a fresh session ID before sending
      const freshSessionId = localStorage.getItem('sessionId');
      if (freshSessionId) {
        this.sessionId = freshSessionId;
        console.log('WebSocket: Retrieved fresh session ID before sending:', freshSessionId);
      } else {
        console.error('WebSocket: No session ID available for sending message');
        return;
      }
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket: Sending message with session ID:', this.sessionId);
      const messageWithSession = {
        ...message,
        sessionId: this.sessionId
      };
      this.ws.send(JSON.stringify(messageWithSession));
    } else {
      console.error('WebSocket: Cannot send message - connection not open');
      if (!this.isConnected) {
        this.connect(this.sessionId); // Try to reconnect with current session ID
      }
    }
  }

  subscribe(listener: ServiceRequestListener) {
    if (!this.listeners.includes(listener)) {
      this.listeners.push(listener);
      console.log('WebSocket: New listener subscribed');
    }
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
      console.log('WebSocket: Listener unsubscribed');
    };
  }

  private notifyListeners(message: WebSocketMessage) {
    this.listeners.forEach(listener => listener(message));
  }

  disconnect() {
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
    console.log('WebSocket: Disconnected and cleaned up');
  }

  // Method to update session ID without reconnecting
  updateSessionId(newSessionId: string) {
    this.sessionId = newSessionId;
    console.log('WebSocket: Updated session ID:', newSessionId);
  }
}

export const wsService = new WebSocketService();