import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests, feedback, tableSessions, restaurants } from "@db/schema";
import { eq, and } from "drizzle-orm";
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { setupAuth } from "./auth";

// Keep track of WebSocket clients by session and restaurant
const clientsBySession = new Map<string, Set<WebSocket>>();
const clientsByRestaurant = new Map<number, Set<WebSocket>>();

// Keep track of client types
const clientTypes = new Map<WebSocket, { 
  type: 'customer' | 'admin';
  restaurantId?: number;
  sessionId: string;
}>();

function broadcastToRestaurant(restaurantId: number, message: any) {
  console.log(`Broadcasting to restaurant ${restaurantId}:`, message);
  const clients = clientsByRestaurant.get(restaurantId);
  if (clients) {
    const messageStr = JSON.stringify(message);
    console.log(`Found ${clients.size} clients for restaurant ${restaurantId}`);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        console.log('Sending to client with type:', clientTypes.get(client)?.type);
        client.send(messageStr);
      }
    });
  } else {
    console.log(`No clients found for restaurant ${restaurantId}`);
  }
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
      const restaurantId = url.searchParams.get('restaurantId');

      console.log('WebSocket connection request:', {
        sessionId,
        clientType,
        restaurantId
      });

      if (!sessionId || !clientType) {
        console.log('WebSocket: Connection rejected - Missing required parameters');
        return false;
      }

      // Store parameters in request for use in connection handler
      (req as any).sessionId = sessionId;
      (req as any).clientType = clientType;
      (req as any).restaurantId = restaurantId ? Number(restaurantId) : undefined;

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

  // WebSocket setup section
  wss.on("connection", (ws: WebSocket, req: any) => {
    const { sessionId, clientType, restaurantId } = req;

    console.log("WebSocket: New connection:", {
      sessionId,
      clientType,
      restaurantId
    });

    // Add client to session group
    if (!clientsBySession.has(sessionId)) {
      clientsBySession.set(sessionId, new Set());
    }
    clientsBySession.get(sessionId)!.add(ws);

    // If it's an admin client and restaurantId is provided, add to restaurant group
    if (clientType === 'admin' && restaurantId) {
      if (!clientsByRestaurant.has(restaurantId)) {
        clientsByRestaurant.set(restaurantId, new Set());
      }
      clientsByRestaurant.get(restaurantId)!.add(ws);
    }

    // Store client info
    clientTypes.set(ws, {
      type: clientType,
      restaurantId: restaurantId,
      sessionId
    });

    ws.on("message", async (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('WebSocket: Received message:', data);

        // Validate session ID in message matches connection
        if (data.sessionId !== sessionId) {
          console.error('WebSocket: Session ID mismatch');
          return;
        }

        // Handle broadcasting based on message type and client type
        if (data.broadcast && data.restaurantId) {
          console.log('Broadcasting message to restaurant:', data.restaurantId);
          broadcastToRestaurant(data.restaurantId, data);
        } else {
          // Only broadcast to clients in the same session
          const sessionClients = clientsBySession.get(sessionId);
          if (sessionClients) {
            console.log(`Broadcasting to ${sessionClients.size} session clients`);
            sessionClients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
              }
            });
          }
        }
      } catch (error) {
        console.error("WebSocket: Failed to process message:", error);
      }
    });

    ws.on("close", () => {
      console.log("WebSocket: Client disconnected:", {
        sessionId,
        clientType,
        restaurantId
      });

      // Remove from session group
      const sessionClients = clientsBySession.get(sessionId);
      if (sessionClients) {
        sessionClients.delete(ws);
        if (sessionClients.size === 0) {
          clientsBySession.delete(sessionId);
        }
      }

      // Remove from restaurant group if applicable
      if (restaurantId) {
        const restaurantClients = clientsByRestaurant.get(restaurantId);
        if (restaurantClients) {
          restaurantClients.delete(ws);
          if (restaurantClients.size === 0) {
            clientsByRestaurant.delete(restaurantId);
          }
        }
      }

      // Clean up client type
      clientTypes.delete(ws);
    });
  });

  // Restaurant routes
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

  // Table routes - all within restaurant context
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

    // Verify restaurant ownership
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
      // Get the domain, with fallback and logging
      const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || req.get('host');
      console.log('Using domain for QR:', domain);

      // First create the table
      const [table] = await db.insert(tables)
        .values({
          name,
          restaurantId: Number(restaurantId),
          qrCode: '', // Temporary empty QR code
          position,
        })
        .returning();

      console.log('Created table:', table);

      // Generate QR code with full URL - updated to point to the table page
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

      // Update the table with the generated QR code
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

  // Add specific endpoint to verify table exists
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

    // Verify restaurant ownership and table existence
    const [restaurant] = await db.query.restaurants.findMany({
      where: and(
        eq(restaurants.id, Number(restaurantId)),
        eq(restaurants.ownerId, req.user!.id)
      ),
    });

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    // Validate the position object
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

      // Broadcast the update to all connected clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: "update_table",
            table: updatedTable
          }));
        }
      });

      res.json(updatedTable);
    } catch (error) {
      console.error('Error updating table:', error);
      res.status(500).json({ message: "Failed to update table position" });
    }
  });

  app.delete("/api/restaurants/:restaurantId/tables/:tableId", ensureAuthenticated, async (req, res) => {
    const { restaurantId, tableId } = req.params;

    // Verify restaurant ownership
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

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "delete_table",
          tableId,
          restaurantId
        }));
      }
    });

    res.json(deletedTable);
  });

  // Session management
  app.post("/api/restaurants/:restaurantId/tables/:tableId/sessions", async (req, res) => {
    const { restaurantId, tableId } = req.params;

    try {
      console.log(`Creating/retrieving session for table ${tableId} in restaurant ${restaurantId}`);

      // Verify the table belongs to the restaurant
      const table = await verifyTableAccess(Number(restaurantId), Number(tableId));

      // Check for existing active session
      const existingSession = await getActiveTableSession(Number(tableId));

      if (existingSession) {
        console.log(`Found existing session ${existingSession.id} for table ${tableId}`);
        return res.json({
          ...existingSession,
          restaurant: table.restaurant,
          tableName: table.name
        });
      }

      // Close any existing active sessions for this table (just in case)
      await db.update(tableSessions)
        .set({ endedAt: new Date() })
        .where(and(
          eq(tableSessions.tableId, Number(tableId)),
          eq(tableSessions.endedAt, null)
        ));

      // Create new session with unique ID
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

  // Request routes
  app.get("/api/requests", async (req, res) => {
    const { tableId, restaurantId, sessionId } = req.query;
    console.log(`Fetching requests for table ${tableId} in restaurant ${restaurantId}, session ${sessionId}`);

    try {
      // Validate parameters
      const parsedTableId = tableId ? parseInt(tableId as string) : null;
      const parsedRestaurantId = restaurantId ? parseInt(restaurantId as string) : null;

      if (!parsedTableId || isNaN(parsedTableId) || !parsedRestaurantId || isNaN(parsedRestaurantId) || !sessionId) {
        console.log('Invalid parameters:', { tableId, restaurantId, sessionId });
        return res.status(400).json({ message: "Invalid parameters" });
      }

      // First verify the table belongs to the restaurant
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

      // Now get requests for this table and session
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
      // Verify the table belongs to the specified restaurant
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

      // Create the request
      const [request] = await db.insert(requests)
        .values({
          tableId: Number(tableId),
          sessionId,
          type,
          notes,
        })
        .returning();

      console.log(`Created request ${request.id} for table ${tableId}`);

      // Broadcast to WebSocket clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "new_request", request }));
        }
      });

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
    const { status } = req.body;

    const [request] = await db
      .update(requests)
      .set({
        status,
        ...(status === "completed" ? { completedAt: new Date() } : {}),
      })
      .where(eq(requests.id, Number(id)))
      .returning();

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "update_request", request }));
      }
    });

    res.json(request);
  });

  // Feedback routes
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

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "new_feedback",
          feedback: newFeedback
        }));
      }
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