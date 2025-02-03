type ServiceRequestListener = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners: ServiceRequestListener[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket: Already connected');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    console.log('WebSocket: Attempting to connect to', `${protocol}//${host}/ws`);

    this.ws = new WebSocket(`${protocol}//${host}/ws`);

    this.ws.onopen = () => {
      console.log('WebSocket: Connection established');
      this.reconnectAttempts = 0;
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
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log(`WebSocket: Attempting to reconnect (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
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

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket: Sending message', data);
      this.ws.send(JSON.stringify(data));
    } else {
      console.error('WebSocket: Cannot send message - connection not open');
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
}

export const wsService = new WebSocketService();