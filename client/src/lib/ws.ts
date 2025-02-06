import { useToast } from "@/hooks/use-toast";

type ServiceRequestListener = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners: ServiceRequestListener[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: number | null = null;
  private pendingMessages: any[] = [];

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected');
      this.processPendingMessages();
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    // Add session information to the WebSocket URL if available
    const tableId = window.location.pathname.match(/\/request\/\d+\/(\d+)/)?.[1];
    const sessionData = tableId ? localStorage.getItem(`table_session_${tableId}`) : null;
    let wsUrl = `${protocol}//${host}/ws`;

    if (sessionData) {
      try {
        const { sessionId } = JSON.parse(sessionData);
        wsUrl += `?sessionId=${encodeURIComponent(sessionId)}`;
        console.log('[WS] Connecting with session ID');
      } catch (e) {
        console.error('[WS] Error parsing session data:', e);
      }
    }

    console.log('[WS] Connecting to:', wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[WS] Connected successfully');
      this.reconnectAttempts = 0;
      this.startPingInterval();
      this.processPendingMessages();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'ping') {
          console.log('[WS] Message received:', data);
        }
        this.notifyListeners(data);
      } catch (error) {
        console.error('[WS] Error parsing message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('[WS] Connection closed');
      this.cleanup();

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`[WS] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WS] Error:', error);
    };
  }

  private processPendingMessages() {
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift();
      this.send(message);
    }
  }

  private notifyListeners(data: any) {
    this.listeners.forEach(listener => {
      try {
        listener(data);
      } catch (error) {
        console.error('[WS] Error in listener:', error);
      }
    });
  }

  private startPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', timestamp: new Date().toISOString() });
      }
    }, 30000); // Send ping every 30 seconds
  }

  private cleanup() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.ws = null;
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
      } catch (error) {
        console.error('[WS] Error sending message:', error);
        this.pendingMessages.push(data);
      }
    } else {
      console.warn('[WS] Not connected. Message queued:', data);
      this.pendingMessages.push(data);
      this.connect();
    }
  }

  subscribe(listener: ServiceRequestListener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnection attempts during intentional disconnect
      this.ws.close();
      this.cleanup();
    }
    this.listeners = [];
    this.pendingMessages = [];
    this.reconnectAttempts = 0;
  }
}

export const wsService = new WebSocketService();