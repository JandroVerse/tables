import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests, feedback } from "@db/schema";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";

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

  // WebSocket handling
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
    const { name } = req.body;
    const [table] = await db.insert(tables).values({
      name,
      qrCode: '',
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

  // Request routes
  app.get("/api/requests", async (req, res) => {
    const { tableId } = req.query;
    const query = tableId
      ? { where: eq(requests.tableId, Number(tableId)) }
      : undefined;

    const allRequests = await db.query.requests.findMany(query);
    res.json(allRequests);
  });

  app.post("/api/requests", async (req, res) => {
    const { tableId, type, notes } = req.body;

    const [request] = await db.insert(requests).values({
      tableId,
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

    // Check if the request exists and is completed
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

    // Check if feedback already exists
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

    // Notify connected clients about new feedback
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