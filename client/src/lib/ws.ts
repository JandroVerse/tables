import { z } from "zod";

type ServiceRequestListener = (data: any) => void;

interface WebSocketMessage {
  type: 'new_request' | 'update_request' | 'connection_status' | 'ping' | 'admin_data_request' | 'admin_data_response';
  tableId?: number;
  restaurantId?: number;
  request?: any;
  status?: 'connected' | 'disconnected' | 'reconnecting';
  clientType?: 'customer' | 'admin';
  data?: any;
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

    connect(sessionId: string, type: 'customer' | 'admin' = 'customer') {
      if (!sessionId) {
        console.error('WebSocket: Cannot connect without sessionId');
        return;
      }

      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.sessionId === sessionId) {
        console.log('WebSocket: Already connected with same sessionId');
        return;
      }

      // Clean up existing connection if any
      this.disconnect();

      this.sessionId = sessionId;
      this.clientType = type;

      console.log('WebSocket: Connecting with session ID:', this.sessionId, 'type:', type);

      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = new URL(`${protocol}//${host}/ws`);
        wsUrl.searchParams.append('sessionId', this.sessionId);
        wsUrl.searchParams.append('clientType', this.clientType);

        console.log('WebSocket: Connecting to URL:', wsUrl.toString());
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

            // Special handling for admin data requests when in customer mode
            if (this.clientType === 'customer' && data.type === 'admin_data_request') {
              this.handleAdminDataRequest(data);
              return;
            }

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

    private handleAdminDataRequest(data: WebSocketMessage) {
      // When customer receives admin request, send back current state
      if (this.clientType === 'customer' && this.sessionId) {
        this.send({
          type: 'admin_data_response',
          tableId: data.tableId,
          restaurantId: data.restaurantId,
          data: {
            lastUpdate: new Date().toISOString()
          }
        });
      }
    }

    private handleReconnect() {
      if (this.connectionTimer) {
        clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
      }

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
        this.connectionTimer = setTimeout(() => this.connect(this.sessionId!, this.clientType), delay);
      } else {
        console.error('WebSocket: Max reconnection attempts reached');
      }
    }

    send(message: WebSocketMessage) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.error('WebSocket: Cannot send message - connection not open');
        if (this.sessionId) {
          this.connect(this.sessionId, this.clientType);
        }
        return;
      }

      const messageWithSession = {
        ...message,
        sessionId: this.sessionId,
        clientType: this.clientType
      };

      console.log('WebSocket: Sending message:', messageWithSession);
      try {
        this.ws.send(JSON.stringify(messageWithSession));
      } catch (error) {
        console.error('WebSocket: Error sending message:', error);
        this.ws.close();
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

    // Method for admin to request data from customer
    requestCustomerData(tableId: number, restaurantId: number) {
      if (this.clientType !== 'admin') {
        console.error('WebSocket: Only admin can request customer data');
        return;
      }

      this.send({
        type: 'admin_data_request',
        tableId,
        restaurantId
      });
    }
}

export const wsService = new WebSocketService();