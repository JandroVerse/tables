import { useEffect, useCallback } from 'react';
import { wsService } from '@/lib/ws';
import { useQueryClient } from '@tanstack/react-query';
import type { DashboardUpdate, DashboardCommand } from '@/types/dashboard';

export function useDashboardSync(sessionId: string, restaurantId: number) {
  const queryClient = useQueryClient();

  const handleWebSocketMessage = useCallback((message: DashboardUpdate | DashboardCommand) => {
    if (message.type === 'client_update') {
      // Update table status and requests in the cache
      queryClient.setQueryData(
        ['/api/restaurants', restaurantId, 'tables', message.data.tableId],
        (oldData: any) => ({
          ...oldData,
          status: message.data.tableStatus,
          lastActivity: message.data.lastActivity
        })
      );

      // Update requests cache
      queryClient.setQueryData(
        ['/api/requests', message.data.tableId],
        message.data.currentRequests
      );
    }
  }, [queryClient, restaurantId]);

  useEffect(() => {
    if (!sessionId || !restaurantId) return;

    // Connect to WebSocket
    wsService.connect(sessionId);

    // Subscribe to updates
    const unsubscribe = wsService.on('client_update', handleWebSocketMessage);

    // Send initial sync request
    wsService.send({
      type: 'server_update',
      timestamp: new Date().toISOString(),
      sessionId,
      action: 'full_sync',
      targetTableId: 0,
      data: { restaurantId }
    });

    return () => {
      unsubscribe();
      wsService.disconnect();
    };
  }, [sessionId, restaurantId, handleWebSocketMessage]);

  const sendCommand = useCallback((command: Omit<DashboardCommand, 'timestamp' | 'sessionId'>) => {
    wsService.send({
      ...command,
      timestamp: new Date().toISOString(),
      sessionId
    });
  }, [sessionId]);

  return { sendCommand };
}
