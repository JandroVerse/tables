type ServiceRequestListener = (data: any) => void;

interface WebSocketMessage {
  type: 'new_request' | 'update_request' | 'connection_status';
  tableId?: number;
  restaurantId?: number;
  token?: string;
  request?: any;
  status?: 'connected' | 'disconnected' | 'reconnecting';
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners: ServiceRequestListener[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private isConnected = false;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket: Already connected');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    // Support both authentication methods
    const sessionId = localStorage.getItem('sessionId');
    const tableToken = localStorage.getItem('tableToken');
    const authQuery = tableToken 
      ? `?token=${tableToken}`
      : sessionId 
      ? `?sessionId=${sessionId}` 
      : '';

    console.log('WebSocket: Attempting to connect to', `${protocol}//${host}/ws${authQuery}`);

    this.ws = new WebSocket(`${protocol}//${host}/ws${authQuery}`);

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
      console.log('WebSocket: Received message', event.data);
      try {
        const data = JSON.parse(event.data);
        this.listeners.forEach(listener => listener(data));
      } catch (error) {
        console.error('WebSocket: Error parsing message', error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket: Connection closed');
      this.isConnected = false;
      this.notifyListeners({
        type: 'connection_status',
        status: 'disconnected'
      });

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log(`WebSocket: Attempting to reconnect (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
        this.notifyListeners({
          type: 'connection_status',
          status: 'reconnecting'
        });
        this.reconnectAttempts++;
        setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
      } else {
        console.error('WebSocket: Max reconnection attempts reached');
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket: Error occurred', error);
    };
  }

  send(message: WebSocketMessage) {
    // Ensure we have either token or table/restaurant IDs
    if ((!message.token && (!message.tableId || !message.restaurantId))) {
      console.error('WebSocket: Invalid message - missing required parameters', message);
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket: Sending message', message);

      // Include auth info in message payload
      const sessionId = localStorage.getItem('sessionId');
      const tableToken = localStorage.getItem('tableToken');

      const messageWithAuth = {
        ...message,
        sessionId,
        token: tableToken || message.token
      };

      this.ws.send(JSON.stringify(messageWithAuth));
    } else {
      console.error('WebSocket: Cannot send message - connection not open', {
        readyState: this.ws?.readyState,
        isConnected: this.isConnected,
        message
      });
      if (!this.isConnected) {
        console.log('WebSocket: Attempting to reconnect before sending');
        this.connect();
      }
    }
  }

  subscribe(listener: ServiceRequestListener) {
    console.log('WebSocket: New listener subscribed');
    this.listeners.push(listener);
    return () => {
      console.log('WebSocket: Listener unsubscribed');
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(message: WebSocketMessage) {
    this.listeners.forEach(listener => listener(message));
  }
}

export const wsService = new WebSocketService();