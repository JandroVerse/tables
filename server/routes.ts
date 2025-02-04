import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests, feedback, tableSessions, restaurants, users, restaurantStaff } from "@db/schema";
import { eq, and, SQL, PgColumn } from "drizzle-orm";
import { nanoid } from "nanoid";
import { setupAuth } from "./auth";
import QRCode from "qrcode";

// WebSocket client tracking
interface WebSocketClient {
  ws: WebSocket;
  sessionId: string;
  lastPing: Date;
}

const clients = new Map<WebSocket, WebSocketClient>();
const sessionClients = new Map<string, Set<WebSocket>>();

function broadcastToSession(sessionId: string, message: any, excludeClient?: WebSocket) {
  const timestamp = new Date().toISOString();
  const fullMessage = { ...message, timestamp, sessionId };

  const clients = sessionClients.get(sessionId);
  if (clients) {
    const messageStr = JSON.stringify(fullMessage);
    clients.forEach(client => {
      if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
        try {
          client.send(messageStr);
        } catch (error) {
          console.error('Error sending message to client:', error);
        }
      }
    });
  }
}

// Clean up inactive clients periodically
function startCleanupInterval() {
  setInterval(() => {
    const now = new Date();
    clients.forEach((client, ws) => {
      if (now.getTime() - client.lastPing.getTime() > 70000) { // No ping for > 70 seconds
        console.log(`Cleaning up inactive client for session ${client.sessionId}`);
        ws.close();
      }
    });
  }, 30000);
}

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    verifyClient: ({ req }) => {
      if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
        return false;
      }
      const url = new URL(req.url!, `http://${req.headers.host}`);
      return !!url.searchParams.get('sessionId');
    }
  });

  wss.on('connection', async (ws: WebSocket, req: Request) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId')!;

    console.log('New WebSocket connection:', { sessionId });

    // Initialize client tracking
    clients.set(ws, {
      ws,
      sessionId,
      lastPing: new Date()
    });

    if (!sessionClients.has(sessionId)) {
      sessionClients.set(sessionId, new Set());
    }
    sessionClients.get(sessionId)!.add(ws);

    // Send initial connection confirmation
    ws.send(JSON.stringify({
      type: 'server_update',
      action: 'connection_established',
      timestamp: new Date().toISOString(),
      sessionId,
      data: { status: 'connected' }
    }));

    ws.on('message', async (data: string) => {
      try {
        const message = JSON.parse(data);
        const client = clients.get(ws);

        if (!client) {
          console.error('Message received from untracked client');
          return;
        }

        // Update last ping time
        client.lastPing = new Date();

        if (message.type === 'ping') {
          ws.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString(),
            sessionId
          }));
          return;
        }

        if (message.type === 'client_update') {
          // Broadcast update to other clients in the same session
          broadcastToSession(sessionId, message, ws);

          // If this is a status update, store it in the database
          if (message.data?.status) {
            await db.update(tableSessions)
              .set({ lastActivityAt: new Date() })
              .where(eq(tableSessions.sessionId, sessionId));
          }
        }

      } catch (error) {
        console.error('Error processing WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          timestamp: new Date().toISOString(),
          sessionId,
          error: 'Invalid message format'
        }));
      }
    });

    ws.on('close', () => {
      const client = clients.get(ws);
      if (client) {
        const clientsForSession = sessionClients.get(client.sessionId);
        if (clientsForSession) {
          clientsForSession.delete(ws);
          if (clientsForSession.size === 0) {
            sessionClients.delete(client.sessionId);
          }
        }
        clients.delete(ws);
      }
    });
  });

  // Start cleanup interval
  startCleanupInterval();

  // Add request logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // Setup authentication
  setupAuth(app);

  app.post("/api/restaurants", ensureAuthenticated, async (req, res) => {
    const { name, address, phone } = req.body;
    const [restaurant] = await db.insert(restaurants)
      .values({
        name,
        ownerId: req.user!.id,
        address,
        phone,
      })
      .returning();
    res.json(restaurant);
  });

  app.get("/api/restaurants", ensureAuthenticated, async (req, res) => {
    const userRestaurants = await db.query.restaurants.findMany({
      where: eq(restaurants.ownerId, req.user!.id),
    });
    res.json(userRestaurants);
  });

  app.get("/api/restaurants/:id", ensureAuthenticated, async (req, res) => {
    const [restaurant] = await db.query.restaurants.findMany({
      where: and(
        eq(restaurants.id, Number(req.params.id)),
        eq(restaurants.ownerId, req.user!.id)
      ),
    });

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    res.json(restaurant);
  });

  app.get("/api/restaurants/:restaurantId/tables", ensureAuthenticated, async (req, res) => {
    const { restaurantId } = req.params;
    const allTables = await db.query.tables.findMany({
      where: eq(tables.restaurantId, Number(restaurantId)),
    });

    res.json(allTables);
  });

  app.post("/api/restaurants/:restaurantId/tables", ensureAuthenticated, async (req, res) => {
    const { restaurantId } = req.params;
    const { name, position } = req.body;

    console.log('Creating table with params:', {
      restaurantId,
      name,
      position,
      userId: req.user!.id
    });

    const [restaurant] = await db.query.restaurants.findMany({
      where: and(
        eq(restaurants.id, Number(restaurantId)),
        eq(restaurants.ownerId, req.user!.id)
      ),
    });

    if (!restaurant) {
      console.log('Restaurant not found or unauthorized:', {
        restaurantId,
        userId: req.user!.id
      });
      return res.status(404).json({ message: "Restaurant not found" });
    }

    console.log('Restaurant verified:', restaurant);

    try {
      const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || req.get('host');
      console.log('Using domain for QR:', domain);

      const [table] = await db.insert(tables)
        .values({
          name,
          restaurantId: Number(restaurantId),
          qrCode: '',
          position,
        })
        .returning();

      console.log('Created table:', table);

      const tableUrl = `https://${domain}/table/${restaurantId}/${table.id}`;
      console.log('Generating QR code for URL:', tableUrl);

      const qrCodeSvg = await QRCode.toString(tableUrl, {
        type: 'svg',
        width: 256,
        margin: 4,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });

      console.log('Generated QR code SVG length:', qrCodeSvg.length);

      const [updatedTable] = await db
        .update(tables)
        .set({ qrCode: qrCodeSvg })
        .where(eq(tables.id, table.id))
        .returning();

      console.log('Successfully updated table with QR code:', updatedTable);

      res.json(updatedTable);
    } catch (error) {
      console.error('Error in table creation/QR generation:', error);
      res.status(500).json({ message: "Failed to create table or generate QR code", error: String(error) });
    }
  });

  app.get("/api/restaurants/:restaurantId/tables/:tableId", async (req, res) => {
    const { restaurantId, tableId } = req.params;

    try {
      console.log(`Verifying access for table ${tableId} in restaurant ${restaurantId}`);
      const table = await verifyTableAccess(Number(restaurantId), Number(tableId));
      res.json(table);
    } catch (error) {
      console.error('Error verifying table:', error);
      res.status(404).json({
        message: error instanceof Error ? error.message : "Table not found or invalid restaurant"
      });
    }
  });

  app.patch("/api/restaurants/:restaurantId/tables/:tableId", ensureAuthenticated, async (req, res) => {
    const { restaurantId, tableId } = req.params;
    const { position, sessionId } = req.body;

    const [restaurant] = await db.query.restaurants.findMany({
      where: and(
        eq(restaurants.id, Number(restaurantId)),
        eq(restaurants.ownerId, req.user!.id)
      ),
    });

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    if (!position || typeof position !== 'object') {
      return res.status(400).json({ message: "Invalid position data" });
    }

    try {
      const [updatedTable] = await db
        .update(tables)
        .set({ position })
        .where(and(
          eq(tables.id, Number(tableId)),
          eq(tables.restaurantId, Number(restaurantId))
        ))
        .returning();

      if (!updatedTable) {
        return res.status(404).json({ message: "Table not found" });
      }

      broadcastToSession(sessionId, {
        type: "update_table",
        table: updatedTable
      });

      res.json(updatedTable);
    } catch (error) {
      console.error('Error updating table:', error);
      res.status(500).json({ message: "Failed to update table position" });
    }
  });

  app.delete("/api/restaurants/:restaurantId/tables/:tableId", ensureAuthenticated, async (req, res) => {
    const { restaurantId, tableId, sessionId } = req.params;

    const [restaurant] = await db.query.restaurants.findMany({
      where: and(
        eq(restaurants.id, Number(restaurantId)),
        eq(restaurants.ownerId, req.user!.id)
      ),
    });

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    await db.delete(requests).where(eq(requests.tableId, Number(tableId)));
    const [deletedTable] = await db.delete(tables)
      .where(and(
        eq(tables.id, Number(tableId)),
        eq(tables.restaurantId, Number(restaurantId))
      ))
      .returning();

    if (!deletedTable) {
      return res.status(404).json({ message: "Table not found" });
    }

    broadcastToSession(sessionId, {
      type: "delete_table",
      tableId,
      restaurantId
    });

    res.json(deletedTable);
  });

  app.post("/api/restaurants/:restaurantId/tables/:tableId/sessions", async (req, res) => {
    const { restaurantId, tableId } = req.params;

    try {
      console.log(`Creating/retrieving session for table ${tableId} in restaurant ${restaurantId}`);

      const table = await verifyTableAccess(Number(restaurantId), Number(tableId));

      const existingSession = await getActiveTableSession(Number(tableId));

      if (existingSession) {
        console.log(`Found existing session ${existingSession.id} for table ${tableId}`);
        return res.json({
          ...existingSession,
          restaurant: table.restaurant,
          tableName: table.name
        });
      }

      await db.update(tableSessions)
        .set({ endedAt: new Date() })
        .where(and(
          eq(tableSessions.tableId, Number(tableId)),
          eq(tableSessions.endedAt, null)
        ));

      const sessionId = nanoid();
      const [session] = await db.insert(tableSessions)
        .values({
          tableId: Number(tableId),
          sessionId,
          startedAt: new Date(),
        })
        .returning();

      console.log(`Created new session ${session.id} for table ${tableId}`);

      res.json({
        ...session,
        restaurant: table.restaurant,
        tableName: table.name
      });
    } catch (error) {
      console.error('Error managing session:', error);
      res.status(500).json({
        message: "Failed to manage session",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.get("/api/requests", async (req, res) => {
    const { tableId, restaurantId, sessionId } = req.query;
    console.log(`Fetching requests for table ${tableId} in restaurant ${restaurantId}, session ${sessionId}`);

    try {
      const parsedTableId = tableId ? parseInt(tableId as string) : null;
      const parsedRestaurantId = restaurantId ? parseInt(restaurantId as string) : null;

      if (!parsedRestaurantId || isNaN(parsedRestaurantId) || !sessionId) {
        console.log('Invalid parameters:', { tableId, restaurantId, sessionId });
        return res.status(400).json({ message: "Invalid parameters" });
      }

      const [table] = await db.query.tables.findMany({
        where: and(
          tableId ? eq(tables.id, parsedTableId) : undefined,
          eq(tables.restaurantId, parsedRestaurantId)
        ),
      });

      if (!table) {
        console.log(`Table ${parsedTableId} not found in restaurant ${parsedRestaurantId}`);
        return res.status(404).json({ message: "Table not found in this restaurant" });
      }

      const allRequests = await db.query.requests.findMany({
        where: and(
          tableId ? eq(requests.tableId, parsedTableId) : undefined,
          eq(requests.sessionId, sessionId as string)
        ),
        with: {
          table: true
        }
      });

      console.log(`Found ${allRequests.length} requests for table ${parsedTableId}`);
      res.json(allRequests);
    } catch (error) {
      console.error('Error fetching requests:', error);
      res.status(500).json({ message: "Failed to fetch requests" });
    }
  });

  app.post("/api/requests", async (req, res) => {
    const { tableId, restaurantId, sessionId, type, notes } = req.body;
    console.log('Received request creation:', {
      tableId,
      restaurantId,
      sessionId,
      type,
      notes
    });

    if (!tableId || !restaurantId || !sessionId || !type) {
      console.error('Missing required fields:', { tableId, restaurantId, sessionId, type });
      return res.status(400).json({ message: "Missing required fields" });
    }

    try {
      const [table] = await db.query.tables.findMany({
        where: and(
          eq(tables.id, Number(tableId)),
          eq(tables.restaurantId, Number(restaurantId))
        ),
      });

      if (!table) {
        console.log(`Table ${tableId} not found in restaurant ${restaurantId}`);
        return res.status(404).json({ message: "Table not found in this restaurant" });
      }

      console.log(`Verified table ${tableId} belongs to restaurant ${restaurantId}`);

      const [request] = await db.insert(requests)
        .values({
          tableId: Number(tableId),
          sessionId,
          type,
          notes,
        })
        .returning();

      console.log(`Created request ${request.id} for table ${tableId}`);

      // Broadcast to all clients in the session
      broadcastToSession(sessionId, { type: "new_request", request });

      res.json(request);
    } catch (error) {
      console.error('Error creating request:', error);
      res.status(500).json({
        message: "Failed to create request",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.patch("/api/requests/:id", async (req, res) => {
    const { id } = req.params;
    const { status, sessionId } = req.body;

    const [request] = await db
      .update(requests)
      .set({
        status,
        ...(status === "completed" ? { completedAt: new Date() } : {}),
      })
      .where(eq(requests.id, Number(id)))
      .returning();

    broadcastToSession(sessionId, { type: "update_request", request });

    res.json(request);
  });

  app.post("/api/feedback", async (req, res) => {
    const { requestId, rating, comment } = req.body;

    const request = await db.query.requests.findFirst({
      where: eq(requests.id, requestId),
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.status !== "completed") {
      return res.status(400).json({
        message: "Can only provide feedback for completed requests"
      });
    }

    const existingFeedback = await db.query.feedback.findFirst({
      where: eq(feedback.requestId, requestId),
    });

    if (existingFeedback) {
      return res.status(400).json({
        message: "Feedback already submitted for this request"
      });
    }

    const [newFeedback] = await db.insert(feedback)
      .values({
        requestId,
        rating,
        comment,
      })
      .returning();

    broadcastToSession(request.sessionId, {
      type: "new_feedback",
      feedback: newFeedback
    });

    res.json(newFeedback);
  });

  app.get("/api/feedback", async (req, res) => {
    const { requestId } = req.query;
    const query = requestId
      ? { where: eq(feedback.requestId, Number(requestId)) }
      : undefined;

    const allFeedback = await db.query.feedback.findMany(query);
    res.json(allFeedback);
  });

  app.get("/api/users", ensureAuthenticated, async (req, res) => {
    if (!req.user!.isAdmin) {
      return res.status(403).json({ message: "Only admins can view all users" });
    }

    try {
      const allUsers = await db.query.users.findMany({
        orderBy: (users, { asc }) => [asc(users.username)],
      });

      const safeUsers = allUsers.map(({ password, ...user }) => user);
      res.json(safeUsers);
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.delete("/api/users/:id", ensureAuthenticated, async (req, res) => {
    const { id } = req.params;
    const userId = Number(id);

    if (!req.user!.isAdmin) {
      return res.status(403).json({ message: "Only admins can delete users" });
    }

    try {
      console.log(`Starting deletion process for user ${userId}`);

      const userRestaurants = await db.query.restaurants.findMany({
        where: eq(restaurants.ownerId, userId),
      });

      console.log(`Found ${userRestaurants.length} restaurants owned by user ${userId}`);

      for (const restaurant of userRestaurants) {
        console.log(`Processing restaurant ${restaurant.id}`);

        const restaurantTables = await db.query.tables.findMany({
          where: eq(tables.restaurantId, restaurant.id),
        });

        console.log(`Found ${restaurantTables.length} tables for restaurant ${restaurant.id}`);

        for (const table of restaurantTables) {
          console.log(`Processing table ${table.id}`);

          const tableRequests = await db.query.requests.findMany({
            where: eq(requests.tableId, table.id),
          });

          for (const request of tableRequests) {
            await db.delete(feedback)
              .where(eq(feedback.requestId, request.id));
          }

          await db.delete(requests)
            .where(eq(requests.tableId, table.id));

          await db.delete(tableSessions)
            .where(eq(tableSessions.tableId, table.id));
        }

        await db.delete(tables)
          .where(eq(tables.restaurantId, restaurant.id));

        await db.delete(restaurantStaff)
          .where(eq(restaurantStaff.restaurantId, restaurant.id));
      }

      await db.delete(restaurants)
        .where(eq(restaurants.ownerId, userId));

      await db.delete(restaurantStaff)
        .where(eq(restaurantStaff.userId, userId));

      const [deletedUser] = await db.delete(users)
        .where(eq(users.id, userId))
        .returning();

      if (!deletedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      console.log(`Successfully deleted user ${userId} and all associated data`);
      res.json({ message: "User and all associated data deleted successfully", user: deletedUser });
    } catch (error) {
      console.error('Error in deletion process:', error);
      res.status(500).json({
        message: "Failed to delete user and associated data",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return httpServer;
}

async function verifyTableAccess(restaurantId: number, tableId: number) {
  const [table] = await db.query.tables.findMany({
    where: and(
      eq(tables.id, tableId),
      eq(tables.restaurantId, restaurantId)
    ),
    with: {
      restaurant: true
    }
  });

  if (!table) {
    throw new Error(`Table ${tableId} not found in restaurant ${restaurantId}`);
  }

  return table;
}

async function getActiveTableSession(tableId: number) {
  const [activeSession] = await db
    .select()
    .from(tableSessions)
    .where(and(
      eq(tableSessions.tableId, tableId),
      eq(tableSessions.endedAt, null)
    ))
    .limit(1);

  return activeSession;
}

function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Not authenticated" });
}