import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests, feedback, tableSessions, restaurants, users } from "@db/schema";
import { eq, and, isNull, or } from "drizzle-orm";
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { customAlphabet } from 'nanoid';
import { setupAuth } from "./auth";
import { IncomingMessage } from 'http';

function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
    const publicPaths = [
        new RegExp('^/api/restaurants/\\d+/tables/\\d+/verify$'),
        new RegExp('^/api/restaurants/\\d+/tables/\\d+/sessions$'),
        new RegExp('^/api/restaurants/\\d+/tables/\\d+/sessions/end$'),
        new RegExp('^/api/requests$'),
        new RegExp('^/api/requests/\\d+$'),
        new RegExp('^/ws$')
    ];

    const isPublicPath = publicPaths.some(regex => regex.test(req.path));
    if (isPublicPath) {
        return next();
    }

    if (req.isAuthenticated()) {
        return next();
    }

    res.status(401).json({ message: "Not authenticated" });
}

const generateSessionId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 7);

export function registerRoutes(app: Express): Server {
    const httpServer = createServer(app);

    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        verifyClient: async ({ req }: { req: IncomingMessage }) => {
            if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
                return false;
            }
            const url = new URL(req.url!, `http://${req.headers.host}`);
            const sessionId = url.searchParams.get('sessionId');
            if (sessionId) {
                return true;
            }
            return req.isAuthenticated?.() || false;
        }
    });

    setupAuth(app);

    // Restaurant routes
    app.post("/api/restaurants", ensureAuthenticated, async (req: Request, res: Response) => {
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

    app.get("/api/restaurants", ensureAuthenticated, async (req: Request, res: Response) => {
        const userRestaurants = await db.query.restaurants.findMany({
            where: eq(restaurants.ownerId, req.user!.id),
        });
        res.json(userRestaurants);
    });

    app.get("/api/restaurants/:id", ensureAuthenticated, async (req: Request, res: Response) => {
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

    // Table routes
    app.get("/api/restaurants/:restaurantId/tables", ensureAuthenticated, async (req: Request, res: Response) => {
        const { restaurantId } = req.params;
        const allTables = await db.query.tables.findMany({
            where: eq(tables.restaurantId, Number(restaurantId)),
        });
        res.json(allTables);
    });

    app.post("/api/restaurants/:restaurantId/tables", ensureAuthenticated, async (req: Request, res: Response) => {
        const { restaurantId } = req.params;
        const { name, position } = req.body;

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
            const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || req.get('host');
            const [table] = await db.insert(tables)
                .values({
                    name,
                    restaurantId: Number(restaurantId),
                    qrCode: '',
                    position,
                })
                .returning();

            const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
            const tableUrl = `${protocol}://${domain}/request/${restaurantId}/${table.id}`;

            const qrCodeSvg = await QRCode.toString(tableUrl, {
                type: 'svg',
                width: 256,
                margin: 4,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });

            const [updatedTable] = await db
                .update(tables)
                .set({ qrCode: qrCodeSvg })
                .where(eq(tables.id, table.id))
                .returning();

            res.json(updatedTable);
        } catch (error) {
            console.error('Error in table creation/QR generation:', error);
            res.status(500).json({ message: "Failed to create table or generate QR code" });
        }
    });

    // User management routes
    app.get("/api/users", ensureAuthenticated, async (req: Request, res: Response) => {
        try {
            if (req.user?.role !== "owner") {
                return res.status(403).json({ message: "Only owners can view all users" });
            }

            const allUsers = await db.query.users.findMany({
                columns: {
                    id: true,
                    username: true,
                    email: true,
                    role: true,
                    password: true,
                    createdAt: true
                }
            });

            res.json(allUsers);
        } catch (error) {
            console.error('Error fetching users:', error);
            res.status(500).json({ message: "Failed to fetch users" });
        }
    });

    app.delete("/api/users/:id", ensureAuthenticated, async (req: Request, res: Response) => {
        try {
            const { id } = req.params;

            if (req.user?.role !== "owner") {
                return res.status(403).json({ message: "Only owners can delete users" });
            }

            if (Number(id) === req.user.id) {
                return res.status(400).json({ message: "Cannot delete your own account" });
            }

            const [deletedUser] = await db.delete(users)
                .where(eq(users.id, Number(id)))
                .returning();

            if (!deletedUser) {
                return res.status(404).json({ message: "User not found" });
            }

            res.json({ message: "User deleted successfully", user: deletedUser });
        } catch (error) {
            console.error('Error deleting user:', error);
            res.status(500).json({ message: "Failed to delete user" });
        }
    });

    // Request management
    app.get("/api/requests", async (req: Request, res: Response) => {
        const { tableId, sessionId } = req.query;

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

    app.patch("/api/requests/:id", async (req: Request, res: Response) => {
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
                client.send(JSON.stringify({
                    type: "update_request",
                    request,
                    tableId: request.tableId
                }));
            }
        });

        res.json(request);
    });


    // Session management
    app.post("/api/restaurants/:restaurantId/tables/:tableId/sessions", async (req: Request, res: Response) => {
        try {
            const { restaurantId, tableId } = req.params;
            const sessionId = generateSessionId();

            // Close any existing active sessions for this table
            await db.update(tableSessions)
                .set({ endedAt: new Date() })
                .where(and(
                    eq(tableSessions.tableId, Number(tableId)),
                    isNull(tableSessions.endedAt)
                ));

            // Create new session
            const [session] = await db.insert(tableSessions)
                .values({
                    tableId: Number(tableId),
                    sessionId,
                    startedAt: new Date(),
                })
                .returning();

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

    app.post("/api/restaurants/:restaurantId/tables/:tableId/sessions/end", async (req: Request, res: Response) => {
        const { restaurantId, tableId } = req.params;
        const { sessionId } = req.body;

        try {
            // Broadcast session end to all connected clients
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: "end_session",
                        tableId: Number(tableId),
                        sessionId,
                        reason: "admin_ended"
                    }));
                }
            });

            // Close the session
            await db.update(tableSessions)
                .set({ endedAt: new Date() })
                .where(and(
                    eq(tableSessions.tableId, Number(tableId)),
                    eq(tableSessions.sessionId, sessionId),
                    isNull(tableSessions.endedAt)
                ));

            // Close all pending and in-progress requests
            const updatedRequests = await db
                .update(requests)
                .set({
                    status: "cleared",
                    completedAt: new Date()
                })
                .where(and(
                    eq(requests.tableId, Number(tableId)),
                    eq(requests.sessionId, sessionId),
                    or(
                        eq(requests.status, "pending"),
                        eq(requests.status, "in_progress")
                    )
                ))
                .returning();

            // Send request updates
            if (updatedRequests.length > 0) {
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        updatedRequests.forEach(request => {
                            client.send(JSON.stringify({
                                type: "update_request",
                                request,
                                tableId: Number(tableId)
                            }));
                        });
                    }
                });
            }

            res.json({
                message: "Session ended successfully",
                updatedRequestsCount: updatedRequests.length
            });
        } catch (error) {
            console.error('Error ending session:', error);
            res.status(500).json({ message: "Failed to end session" });
        }
    });

    // Feedback routes
    app.post("/api/feedback", async (req: Request, res: Response) => {
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

    app.get("/api/feedback", async (req: Request, res: Response) => {
        const { requestId } = req.query;
        const query = requestId
            ? { where: eq(feedback.requestId, Number(requestId)) }
            : undefined;

        const allFeedback = await db.query.feedback.findMany(query);
        res.json(allFeedback);
    });

    app.post("/api/requests/clear-completed", async (req: Request, res: Response) => {
        try {
            const updatedRequests = await db
                .update(requests)
                .set({
                    status: "cleared",
                    completedAt: new Date()
                })
                .where(eq(requests.status, "completed"))
                .returning();

            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    updatedRequests.forEach(request => {
                        client.send(JSON.stringify({
                            type: "update_request",
                            request,
                            tableId: request.tableId
                        }));
                    });
                }
            });

            res.json({
                message: "Successfully cleared completed requests",
                clearedCount: updatedRequests.length
            });
        } catch (error) {
            console.error('Error clearing completed requests:', error);
            res.status(500).json({ message: "Failed to clear completed requests" });
        }
    });

    return httpServer;
}