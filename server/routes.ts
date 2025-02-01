import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests } from "@db/schema";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ 
    server: httpServer,
    verifyClient: ({ req }) => {
      // Ignore Vite HMR WebSocket connections
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
      // Broadcast updates to all connected clients
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

  app.post("/api/tables", async (req, res) => {
    const { name } = req.body;

    // First create the table to get its ID
    const [table] = await db.insert(tables).values({
      name,
      qrCode: '', // Temporary empty value
    }).returning();

    // Generate QR code with the actual table ID
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

    // Update the table with the generated QR code
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

    // Notify connected clients
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

    // Notify connected clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "update_request", request }));
      }
    });

    res.json(request);
  });

  return httpServer;
}