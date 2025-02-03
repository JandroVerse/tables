import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests, feedback, tableSessions, restaurants } from "@db/schema";
import { eq, and } from "drizzle-orm";
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { setupAuth } from "./auth";

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
  wss.on("connection", (ws: WebSocket) => {
    console.log("New WebSocket connection");
    ws.on("message", (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        // Only broadcast to clients in the same restaurant context
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
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

    console.log('Verifying table access:', {
      restaurantId,
      tableId
    });

    try {
      const [table] = await db.query.tables.findMany({
        where: and(
          eq(tables.id, Number(tableId)),
          eq(tables.restaurantId, Number(restaurantId))
        ),
        with: {
          restaurant: true
        }
      });

      if (!table) {
        console.log('Table not found or invalid restaurant:', {
          tableId,
          restaurantId
        });
        return res.status(404).json({ message: "Table not found or invalid restaurant" });
      }

      console.log('Found table with restaurant:', table);

      // Return the table data with restaurant context
      res.json(table);
    } catch (error) {
      console.error('Error verifying table:', error);
      res.status(500).json({ message: "Failed to verify table", error: String(error) });
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
    const sessionId = nanoid();

    try {
      // Verify the table belongs to the restaurant first
      const [table] = await db.query.tables.findMany({
        where: and(
          eq(tables.id, Number(tableId)),
          eq(tables.restaurantId, Number(restaurantId))
        ),
      });

      if (!table) {
        return res.status(404).json({ message: "Table not found in this restaurant" });
      }

      // Close any existing active sessions for this table
      await db.update(tableSessions)
        .set({ endedAt: new Date() })
        .where(and(
          eq(tableSessions.tableId, Number(tableId)),
          eq(tableSessions.endedAt, null)
        ));

      // Create new session
      const [session] = await db.insert(tableSessions)
        .values({
          tableId: Number(tableId),
          sessionId,
          startedAt: new Date(),
        })
        .returning();

      res.json({
        ...session,
        restaurantId: Number(restaurantId)
      });
    } catch (error) {
      console.error('Error creating session:', error);
      res.status(500).json({ message: "Failed to create session" });
    }
  });

  // Request routes
  app.get("/api/requests", async (req, res) => {
    const { tableId, restaurantId, sessionId } = req.query;
    console.log(`Fetching requests for table ${tableId} in restaurant ${restaurantId}, session ${sessionId}`);

    try {
      // First verify the table belongs to the restaurant
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

      // Now get requests for this table and session
      const allRequests = await db.query.requests.findMany({
        where: and(
          eq(requests.tableId, Number(tableId)),
          eq(requests.sessionId, sessionId as string)
        ),
        with: {
          table: true
        }
      });

      console.log(`Found ${allRequests.length} requests for table ${tableId}`);
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