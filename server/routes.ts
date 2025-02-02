import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests, feedback, tableSessions } from "@db/schema";
import { eq, and } from "drizzle-orm";
import QRCode from "qrcode";
import { nanoid } from "nanoid";

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

  wss.on("connection", (ws: WebSocket) => {
    console.log("New WebSocket connection");
    ws.on("message", (message: string) => {
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    });
  });

  // Session management
  app.post("/api/tables/:tableId/sessions", async (req, res) => {
    const tableId = Number(req.params.tableId);
    const sessionId = nanoid();

    // Close any existing active sessions for this table
    await db.update(tableSessions)
      .set({ endedAt: new Date() })
      .where(and(
        eq(tableSessions.tableId, tableId),
        eq(tableSessions.endedAt, null)
      ));

    // Create new session
    const [session] = await db.insert(tableSessions)
      .values({
        tableId,
        sessionId,
        startedAt: new Date(),
      })
      .returning();

    res.json(session);
  });

  // Table routes
  app.get("/api/tables", async (req, res) => {
    const allTables = await db.query.tables.findMany();
    res.json(allTables);
  });

  app.delete("/api/tables/:id", async (req, res) => {
    const { id } = req.params;
    await db.delete(requests).where(eq(requests.tableId, Number(id)));
    const [deletedTable] = await db.delete(tables)
      .where(eq(tables.id, Number(id)))
      .returning();

    if (!deletedTable) {
      return res.status(404).json({ message: "Table not found" });
    }

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "delete_table", tableId: id }));
      }
    });

    res.json(deletedTable);
  });

  app.post("/api/tables", async (req, res) => {
    const { name, position } = req.body;
    const [table] = await db.insert(tables).values({
      name,
      qrCode: '',
      position,
    }).returning();

    const qrCodeSvg = await QRCode.toString(
      `${process.env.REPLIT_DOMAINS?.split(",")[0]}/table?id=${table.id}`,
      { 
        type: 'svg',
        width: 256,
        margin: 4,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      }
    );

    const [updatedTable] = await db
      .update(tables)
      .set({ qrCode: qrCodeSvg })
      .where(eq(tables.id, table.id))
      .returning();

    res.json(updatedTable);
  });

  app.patch("/api/tables/:id", async (req, res) => {
    const { id } = req.params;
    const { position } = req.body;

    const [updatedTable] = await db
      .update(tables)
      .set({ position })
      .where(eq(tables.id, Number(id)))
      .returning();

    if (!updatedTable) {
      return res.status(404).json({ message: "Table not found" });
    }

    res.json(updatedTable);
  });

  // Request routes
  app.get("/api/requests", async (req, res) => {
    const { tableId, sessionId } = req.query;
    let query = {};

    if (tableId && sessionId) {
      query = {
        where: and(
          eq(requests.tableId, Number(tableId)),
          eq(requests.sessionId, sessionId as string)
        )
      };
    } else if (tableId) {
      query = { where: eq(requests.tableId, Number(tableId)) };
    }

    const allRequests = await db.query.requests.findMany(query);
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