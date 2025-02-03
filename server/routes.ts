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

      console.log('Created table:', table.id);

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

      if (!updatedTable.qrCode) {
        throw new Error('QR code was not saved properly');
      }

      console.log('Successfully updated table with QR code:', updatedTable.id);

      res.json(updatedTable);
    } catch (error) {
      console.error('Error in table creation/QR generation:', error);
      res.status(500).json({ message: "Failed to create table or generate QR code", error: String(error) });
    }
  });

  // Add specific endpoint to verify table exists
  app.get("/api/restaurants/:restaurantId/tables/:tableId", async (req, res) => {
    const { restaurantId, tableId } = req.params;

    console.log(`Verifying table ${tableId} for restaurant ${restaurantId}`);

    try {
      const [table] = await db.query.tables.findMany({
        where: and(
          eq(tables.id, Number(tableId)),
          eq(tables.restaurantId, Number(restaurantId))
        ),
      });

      console.log('Found table:', table);

      if (!table) {
        console.log('Table not found');
        return res.status(404).json({ message: "Table not found" });
      }

      // Return the table data
      res.json(table);
    } catch (error) {
      console.error('Error verifying table:', error);
      res.status(500).json({ message: "Failed to verify table" });
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

    res.json(session);
  });

  // Request routes
  app.get("/api/requests", async (req, res) => {
    const { tableId, restaurantId, sessionId } = req.query;
    let query = {};

    if (tableId && sessionId && restaurantId) {
      query = {
        where: and(
          eq(requests.tableId, Number(tableId)),
          eq(requests.sessionId, sessionId as string),
          eq(tables.restaurantId, Number(restaurantId))
        )
      };
    } else if (tableId) {
      query = { where: eq(requests.tableId, Number(tableId)) };
    }

    const allRequests = await db.query.requests.findMany({
      ...query,
      with: {
        table: true
      }
    });
    res.json(allRequests);
  });

  app.post("/api/requests", async (req, res) => {
    const { tableId, sessionId, type, notes } = req.body;

    const [request] = await db.insert(requests).values({
      tableId,
      sessionId,
      type,
      notes,
    }).returning();

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "new_request", request }));
      }
    });

    res.json(request);
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