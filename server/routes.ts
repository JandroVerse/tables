import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests, feedback, tableSessions, restaurants } from "@db/schema";
import { eq, and, isNull } from "drizzle-orm";
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { customAlphabet } from 'nanoid';
import { setupAuth } from "./auth";

// Modified to properly type the next function and use regex for path matching
function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  // Allow unauthenticated access to table-related routes and WebSocket connections
  const publicPaths = [
    '/api/restaurants/*/tables/*/verify',
    '/api/restaurants/*/tables/*/sessions',
    '/api/requests',
    '/ws'
  ];

  // Check if the current path matches any of the public paths
  const isPublicPath = publicPaths.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '$');
    return regex.test(req.path);
  });

  if (isPublicPath) {
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Not authenticated" });
}

// Create a nanoid generator for 7-character alphanumeric IDs
const generateSessionId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 7);

// Add type definition for session data
declare module 'express-session' {
  interface Session {
    sessionId?: string;
    tableId?: number;
  }
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
      return true;
    }
  });

  // Add request logging middleware
  app.use((req:Request, res:Response, next:NextFunction) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // Setup authentication
  setupAuth(app);

  // Restaurant routes
  app.post("/api/restaurants", ensureAuthenticated, async (req:Request, res:Response) => {
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

  app.get("/api/restaurants", ensureAuthenticated, async (req:Request, res:Response) => {
    const userRestaurants = await db.query.restaurants.findMany({
      where: eq(restaurants.ownerId, req.user!.id),
    });
    res.json(userRestaurants);
  });

  app.get("/api/restaurants/:id", ensureAuthenticated, async (req:Request, res:Response) => {
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
  app.get("/api/restaurants/:restaurantId/tables", ensureAuthenticated, async (req:Request, res:Response) => {
    const { restaurantId } = req.params;
    const allTables = await db.query.tables.findMany({
      where: eq(tables.restaurantId, Number(restaurantId)),
    });

    res.json(allTables);
  });

  app.post("/api/restaurants/:restaurantId/tables", ensureAuthenticated, async (req:Request, res:Response) => {
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

      // Generate QR code with full URL - updated to use the correct route
      const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
      const tableUrl = `${protocol}://${domain}/request/${restaurantId}/${table.id}`;
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

      console.log('Generated QR code SVG:', qrCodeSvg.substring(0, 100) + '...');

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
      console.log('QR code length:', updatedTable.qrCode.length);

      res.json(updatedTable);
    } catch (error) {
      console.error('Error in table creation/QR generation:', error);
      res.status(500).json({ message: "Failed to create table or generate QR code", error: String(error) });
    }
  });

  // Add specific endpoint to verify table exists
  app.get("/api/restaurants/:restaurantId/tables/:tableId/verify", async (req:Request, res:Response) => {
    const { restaurantId, tableId } = req.params;

    try {
      const [table] = await db.query.tables.findMany({
        where: and(
          eq(tables.id, Number(tableId)),
          eq(tables.restaurantId, Number(restaurantId))
        ),
      });

      if (!table) {
        return res.status(404).json({ message: "Table not found" });
      }

      // Check for active session
      const activeSession = await db.query.tableSessions.findFirst({
        where: and(
          eq(tableSessions.tableId, Number(tableId)),
          isNull(tableSessions.endedAt)
        ),
      });

      // Calculate session expiry
      const SESSION_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
      const now = new Date();

      if (activeSession) {
        const sessionStart = new Date(activeSession.startedAt);
        const sessionAge = now.getTime() - sessionStart.getTime();

        if (sessionAge > SESSION_DURATION) {
          // Session expired, end it
          await db.update(tableSessions)
            .set({ endedAt: now })
            .where(eq(tableSessions.id, activeSession.id));

          res.json({ valid: true, table, requiresNewSession: true });
        } else {
          // Active session exists
          res.json({
            valid: true,
            table,
            activeSession: {
              id: activeSession.sessionId,
              expiresIn: SESSION_DURATION - sessionAge
            }
          });
        }
      } else {
        // No active session
        res.json({ valid: true, table, requiresNewSession: true });
      }
    } catch (error) {
      console.error('Error verifying table:', error);
      res.status(500).json({ message: "Failed to verify table" });
    }
  });

  app.patch("/api/restaurants/:restaurantId/tables/:tableId", ensureAuthenticated, async (req:Request, res:Response) => {
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
          eq(tableSessions.restaurantId, Number(restaurantId))
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

  app.delete("/api/restaurants/:restaurantId/tables/:tableId", ensureAuthenticated, async (req:Request, res:Response) => {
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
  app.post("/api/restaurants/:restaurantId/tables/:tableId/sessions", async (req:Request, res:Response) => {
    const { restaurantId, tableId } = req.params;
    const sessionId = generateSessionId(); // Use the custom generator instead of nanoid()

    try {
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

      // Broadcast new session to all connected clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: "new_session",
            tableId: Number(tableId),
            sessionId: session.sessionId
          }));
        }
      });

      res.json(session);
    } catch (error) {
      console.error('Error creating session:', error);
      res.status(500).json({ message: "Failed to create session" });
    }
  });

  // Add session validation middleware
  const validateSession = async (req: Request, res: Response, next: NextFunction) => {
    const { sessionId } = req.body;
    const tableId = Number(req.params.tableId);

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }

    try {
      const session = await db.query.tableSessions.findFirst({
        where: and(
          eq(tableSessions.tableId, tableId),
          eq(tableSessions.sessionId, sessionId),
          isNull(tableSessions.endedAt)
        ),
      });

      if (!session) {
        return res.status(403).json({ message: "Invalid or expired session" });
      }

      // Check session expiry
      const SESSION_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
      const sessionStart = new Date(session.startedAt);
      const sessionAge = Date.now() - sessionStart.getTime();

      if (sessionAge > SESSION_DURATION) {
        await db.update(tableSessions)
          .set({ endedAt: new Date() })
          .where(eq(tableSessions.id, session.id));
        return res.status(403).json({ message: "Session expired" });
      }

      // Store session data in req.session
      req.session.sessionId = session.sessionId;
      req.session.tableId = session.tableId;
      next();
    } catch (error) {
      console.error('Session validation error:', error);
      res.status(500).json({ message: "Failed to validate session" });
    }
  };

  // Add session validation to request endpoints
  app.post("/api/requests", validateSession, async (req:Request, res:Response) => {
    const { type, notes } = req.body;
    const { sessionId, tableId } = req.session;

    if (!sessionId || !tableId) {
      return res.status(403).json({ message: "Invalid session" });
    }

    try {
      const [request] = await db.insert(requests)
        .values({
          tableId,
          sessionId,
          type,
          notes,
        })
        .returning();

      // Broadcast the new request to all connected clients
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: "new_request",
            request,
            tableId: request.tableId
          }));
        }
      });

      res.json(request);
    } catch (error) {
      console.error('Error creating request:', error);
      res.status(500).json({ message: "Failed to create request" });
    }
  });

  app.get("/api/requests", async (req:Request, res:Response) => {
    const { tableId, sessionId } = req.query;
    let query = {};

    if (tableId && sessionId) {
      const allRequests = await db.query.requests.findMany({
        where: and(
          eq(requests.tableId, Number(tableId)),
          eq(requests.sessionId, sessionId as string)
        ),
        with: {
          table: true
        }
      });
      res.json(allRequests);
    } else if (tableId) {
      const allRequests = await db.query.requests.findMany({
        where: eq(requests.tableId, Number(tableId)),
        with: {
          table: true
        }
      });
      res.json(allRequests);
    } else {
      const allRequests = await db.query.requests.findMany({
        with: {
          table: true
        }
      });
      res.json(allRequests);
    }
  });



  app.patch("/api/requests/:id", async (req:Request, res:Response) => {
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

    // Broadcast the updated request to all connected clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "update_request",
          request,
          tableId: request.tableId
        }));
      }
    });

    res.json(request);
  });

  // Feedback routes
  app.post("/api/feedback", async (req:Request, res:Response) => {
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

  app.get("/api/feedback", async (req:Request, res:Response) => {
    const { requestId } = req.query;
    const query = requestId
      ? { where: eq(feedback.requestId, Number(requestId)) }
      : undefined;

    const allFeedback = await db.query.feedback.findMany(query);
    res.json(allFeedback);
  });

  return httpServer;
}