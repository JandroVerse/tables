import { useEffect, useCallback } from 'react';
import { wsService } from '@/lib/ws';
import { useQueryClient } from '@tanstack/react-query';
import type { DashboardUpdate, DashboardCommand } from '@/types/dashboard';

export function useDashboardSync(sessionId: string, restaurantId: number) {
  const queryClient = useQueryClient();

  const handleWebSocketMessage = useCallback((message: DashboardUpdate | DashboardCommand) => {
    if (message.type === 'server_update') {
      // Update data in the cache based on the server message
      queryClient.invalidateQueries({ queryKey: ['/api/restaurants', restaurantId, 'tables'] });
      queryClient.invalidateQueries({ queryKey: ['/api/requests'] });
    }
  }, [queryClient, restaurantId]);

  useEffect(() => {
    if (!sessionId || !restaurantId) return;

    // Connect to WebSocket
    async function connectWebSocket() {
      try {
        await wsService.connect(sessionId);

        // Send initial sync request
        wsService.send({
          type: 'server_update',
          timestamp: new Date().toISOString(),
          sessionId,
          data: { restaurantId }
        });
      } catch (error) {
        console.error('Failed to connect to WebSocket:', error);
      }
    }

    connectWebSocket();

    return () => {
      wsService.disconnect();
    };
  }, [sessionId, restaurantId]);

  const sendCommand = useCallback((command: Omit<DashboardCommand, 'timestamp' | 'sessionId'>) => {
    wsService.send({
      ...command,
      timestamp: new Date().toISOString(),
      sessionId
    });
  }, [sessionId]);

  return { sendCommand };
}