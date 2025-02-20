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
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WS] Already connected');
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
        const { sessionId: storedSessionId } = JSON.parse(sessionData);
        wsUrl += `?sessionId=${encodeURIComponent(storedSessionId)}`;
        this.isAuthenticated = true;
        console.log('[WS] Connecting with session ID');
      } catch (e) {
        console.error('[WS] Error parsing session data:', e);
        // If there's an error parsing the session, remove it
        if (tableId) {
          localStorage.removeItem(`table_session_${tableId}`);
        }
      }
    }

    console.log('[WS] Connecting to:', wsUrl);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[WS] Connected successfully');
      this.reconnectAttempts = 0;
      this.startPingInterval();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'ping') {
          console.log('[WS] Message received:', data);
        }

        // Handle session end message first and ensure proper cleanup
        if (data.type === 'end_session') {
          const currentTableId = window.location.pathname.match(/\/request\/\d+\/(\d+)/)?.[1];
          if (currentTableId && data.tableId === Number(currentTableId)) {
            console.log('[WS] Session end event received:', data);
            if (data.reason === 'admin_ended' || data.reason === 'expired') {
              // Stop ping interval and perform cleanup before disconnecting
              if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
              }

              // Ensure WebSocket is closed properly
              if (this.ws) {
                this.ws.onclose = null; // Remove onclose handler to prevent reconnection attempts
                this.ws.close();
                this.ws = null;
              }

              this.listeners = [];
              this.isAuthenticated = false;

              // Clear session and redirect
              localStorage.removeItem(`table_session_${currentTableId}`);
              window.location.href = '/session-ended';
              return;
            }
          }
        }

        // Process other messages if not a session end
        this.listeners.forEach(listener => listener(data));
      } catch (error) {
        console.error('[WS] Error parsing message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('[WS] Connection closed');
      this.cleanup();

      if (this.isAuthenticated && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(`[WS] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
      }
    };

    this.ws.onerror = (error) => {
      console.error('[WS] Error:', error);
      this.isAuthenticated = false;
    };
  }

  private startPingInterval() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', timestamp: new Date().toISOString() });
      }
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
        console.error('[WS] Error sending message:', error);
      }
    } else {
      console.warn('[WS] Not connected. Message not sent:', data);
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
      this.ws.close();
      this.cleanup();
    }
    this.listeners = [];
    this.isAuthenticated = false;
  }
}

export const wsService = new WebSocketService();