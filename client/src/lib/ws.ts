import { useToast } from "@/hooks/use-toast";

type ServiceRequestListener = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners: ServiceRequestListener[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: number | null = null;
  private isAuthenticated = false;

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    // Add session information to the WebSocket URL if available
    const tableId = window.location.pathname.match(/\/request\/\d+\/(\d+)/)?.[1];
    const sessionId = tableId ? localStorage.getItem(`table_session_${tableId}`) : null;
    let wsUrl = `${protocol}//${host}/ws`;

    if (sessionId) {
      try {
        const { sessionId: storedSessionId } = JSON.parse(sessionId);
        wsUrl += `?sessionId=${encodeURIComponent(storedSessionId)}`;
        this.isAuthenticated = true;
      } catch (e) {
        console.error('Error parsing session data:', e);
        // If there's an error parsing the session, remove it
        if (tableId) {
          localStorage.removeItem(`table_session_${tableId}`);
        }
      }
    }

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      this.startPingInterval();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'ping') {
          console.log('WebSocket message received:', data);
        }

        // Handle session end message immediately
        if (data.type === 'end_session') {
          const currentTableId = window.location.pathname.match(/\/request\/\d+\/(\d+)/)?.[1];
          if (currentTableId && data.tableId === Number(currentTableId)) {
            localStorage.removeItem(`table_session_${currentTableId}`);
            window.location.href = '/session-ended';
            return;
          }
        }

        this.listeners.forEach(listener => listener(data));
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket connection closed');
      this.cleanup();

      const currentTableId = window.location.pathname.match(/\/request\/\d+\/(\d+)/)?.[1];
      const currentSessionData = currentTableId ? localStorage.getItem(`table_session_${currentTableId}`) : null;

      // Only attempt reconnection if we have a valid session or are authenticated
      if ((currentSessionData || this.isAuthenticated) && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
      } else if (this.reconnectAttempts === this.maxReconnectAttempts) {
        console.error('Maximum reconnection attempts reached');
        // Clear session on max reconnect attempts
        if (currentTableId) {
          localStorage.removeItem(`table_session_${currentTableId}`);
          window.location.href = '/session-ended';
        }
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.isAuthenticated = false;
    };
  }

  private startPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = window.setInterval(() => {
      this.send({ type: 'ping', timestamp: new Date().toISOString() });
    }, 30000);
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
        console.error('Error sending WebSocket message:', error);
      }
    } else {
      if (data.type !== 'ping') {
        console.warn('WebSocket is not connected. Message not sent:', data);
      }
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
      this.ws.close();
      this.cleanup();
    }
    this.listeners = [];
    this.isAuthenticated = false;
  }
}

export const wsService = new WebSocketService();