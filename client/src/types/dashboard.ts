import { z } from "zod";

// Dashboard-specific schemas extending base WebSocket schemas
export const DashboardUpdateSchema = z.object({
  type: z.literal('client_update'),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
  data: z.object({
    tableId: z.number(),
    restaurantId: z.number(),
    tableStatus: z.enum(['occupied', 'available', 'reserved']),
    currentRequests: z.array(z.object({
      id: z.number(),
      type: z.string(),
      status: z.string(),
      notes: z.string().optional(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime().optional()
    })),
    lastActivity: z.string().datetime()
  })
});

export const DashboardCommandSchema = z.object({
  type: z.literal('server_update'),
  timestamp: z.string().datetime(),
  sessionId: z.string(),
  action: z.enum(['update_table_status', 'clear_request', 'full_sync']),
  targetTableId: z.number(),
  data: z.any()
});

export type DashboardUpdate = z.infer<typeof DashboardUpdateSchema>;
export type DashboardCommand = z.infer<typeof DashboardCommandSchema>;
