import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests, feedback, tableSessions, restaurants } from "@db/schema";
import { eq, and } from "drizzle-orm";
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { setupAuth } from "./auth";

// Keep track of WebSocket clients by session
const clientsBySession = new Map<string, Set<WebSocket>>();

// Keep track of client types
const clientTypes = new Map<WebSocket, { 
  type: 'customer' | 'admin';
  sessionId: string;
}>();

function broadcastToSession(sessionId: string, message: any, excludeClient?: WebSocket) {
  console.log(`Broadcasting to session ${sessionId}:`, message);
  const clients = clientsBySession.get(sessionId);
  if (clients) {
    const messageStr = JSON.stringify(message);
    console.log(`Found ${clients.size} clients for session ${sessionId}`);
    clients.forEach((client) => {
      if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
        try {
          console.log('Sending to client with type:', clientTypes.get(client)?.type);
          client.send(messageStr);
        } catch (error) {
          console.error('Error sending message to client:', error);
        }
      }
    });
  } else {
    console.log(`No clients found for session ${sessionId}`);
  }
}

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: ({ req }) => {
      if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
        return false;
      }

      const url = new URL(req.url!, `http://${req.headers.host}`);
      const sessionId = url.searchParams.get('sessionId');
      const clientType = url.searchParams.get('clientType');

      console.log('WebSocket connection request:', {
        sessionId,
        clientType
      });

      if (!sessionId || !clientType) {
        console.log('WebSocket: Connection rejected - Missing required parameters');
        return false;
      }

      (req as any).sessionId = sessionId;
      (req as any).clientType = clientType;

      return true;
    }
  });

  // Add request logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // Setup authentication
  setupAuth(app);

  wss.on("connection", (ws: WebSocket, req: any) => {
    const { sessionId, clientType } = req;

    console.log("WebSocket: New connection:", {
      sessionId,
      clientType
    });

    if (!clientsBySession.has(sessionId)) {
      clientsBySession.set(sessionId, new Set());
    }
    clientsBySession.get(sessionId)!.add(ws);

    clientTypes.set(ws, {
      type: clientType,
      sessionId
    });

    // Send initial connection confirmation
    try {
      ws.send(JSON.stringify({
        type: 'connection_status',
        status: 'connected',
        sessionId
      }));
    } catch (error) {
      console.error('Error sending connection confirmation:', error);
    }

    ws.on("message", async (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('WebSocket: Received message:', data);

        if (data.sessionId !== sessionId) {
          console.error('WebSocket: Session ID mismatch');
          return;
        }

        // Handle ping messages
        if (data.type === 'ping') {
          try {
            ws.send(JSON.stringify({
              type: 'connection_status',
              status: 'connected',
              sessionId
            }));
          } catch (error) {
            console.error('Error sending ping response:', error);
          }
          return;
        }

        // Handle admin data requests
        if (data.type === 'admin_data_request' && clientType === 'admin') {
          // Forward the request to all customers in the session
          broadcastToSession(sessionId, data);
          return;
        }

        // Handle customer data responses
        if (data.type === 'admin_data_response' && clientType === 'customer') {
          // Forward the response to all admins in the session
          const admins = Array.from(clientsBySession.get(sessionId) || [])
            .filter(client => clientTypes.get(client)?.type === 'admin');

          admins.forEach(admin => {
            try {
              admin.send(JSON.stringify(data));
            } catch (error) {
              console.error('Error forwarding customer data to admin:', error);
            }
          });
          return;
        }

        broadcastToSession(sessionId, data, ws);
      } catch (error) {
        console.error("WebSocket: Failed to process message:", error);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket: Client disconnected:", {
        sessionId,
        clientType
      });

      const sessionClients = clientsBySession.get(sessionId);
      if (sessionClients) {
        sessionClients.delete(ws);
        if (sessionClients.size === 0) {
          clientsBySession.delete(sessionId);
        }
      }

      clientTypes.delete(ws);
    });
  });

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
    const { position } = req.body;

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

      broadcastToSession(req.body.sessionId, {
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
    const { restaurantId, tableId } = req.params;

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

    broadcastToSession(req.body.sessionId, {
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

      if (!parsedTableId || isNaN(parsedTableId) || !parsedRestaurantId || isNaN(parsedRestaurantId) || !sessionId) {
        console.log('Invalid parameters:', { tableId, restaurantId, sessionId });
        return res.status(400).json({ message: "Invalid parameters" });
      }

      const [table] = await db.query.tables.findMany({
        where: and(
          eq(tables.id, parsedTableId),
          eq(tables.restaurantId, parsedRestaurantId)
        ),
      });

      if (!table) {
        console.log(`Table ${parsedTableId} not found in restaurant ${parsedRestaurantId}`);
        return res.status(404).json({ message: "Table not found in this restaurant" });
      }

      const allRequests = await db.query.requests.findMany({
        where: and(
          eq(requests.tableId, parsedTableId),
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

function ensureAuthenticated(req: Express.Request, res: Express.Response, next: Express.NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Not authenticated" });
}