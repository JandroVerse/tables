import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { db } from "@db";
import { tables, requests, feedback, tableSessions, restaurants, users } from "@db/schema";
import { eq, and, isNull, or, inArray } from "drizzle-orm";
import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { customAlphabet } from 'nanoid';
import { setupAuth } from "./auth";
import { IncomingMessage } from 'http';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// Update the ensureAuthenticated middleware to properly handle table-related routes
function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
    // Allow unauthenticated access to table-related routes and WebSocket connections
    const publicPaths = [
        // Add exact regex patterns for public paths
        new RegExp('^/api/restaurants/\\d+/tables/\\d+/verify$'),
        new RegExp('^/api/restaurants/\\d+/tables/\\d+/sessions$'),
        new RegExp('^/api/restaurants/\\d+/tables/\\d+/sessions/end$'),
        new RegExp('^/api/requests$'),
        new RegExp('^/api/requests/\\d+$'),
        new RegExp('^/ws$'),
        new RegExp('^/api/restaurants/\\d+/table-sessions$')
    ];

    // Check if the current path matches any of the public paths
    const isPublicPath = publicPaths.some(regex => regex.test(req.path));

    // For public paths, always allow access
    if (isPublicPath) {
        return next();
    }

    // For non-public paths, require authentication
    if (req.isAuthenticated()) {
        return next();
    }

    console.log('[Auth Failed]', {
        path: req.path,
        method: req.method,
        headers: req.headers
    });

    res.status(401).json({ message: "Not authenticated" });
}

// Create a nanoid generator for 7-character alphanumeric IDs
const generateSessionId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 7);

// Update the session interface definition
declare module 'express-session' {
    interface Session {
        sessionId?: string;
        tableId?: number;
    }
}

export function registerRoutes(app: Express): Server {
    const httpServer = createServer(app);
    // Update the WebSocket verifyClient function to handle table requests properly
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws',
        verifyClient: async ({ req }: { req: IncomingMessage }) => {
            // Ignore Vite HMR connections
            if (req.headers['sec-websocket-protocol'] === 'vite-hmr') {
                return false;
            }

            // Extract session ID from query parameters
            const url = new URL(req.url!, `http://${req.headers.host}`);
            const sessionId = url.searchParams.get('sessionId');

            // Allow connections with sessionId (for table connections)
            if (sessionId) {
                return true;
            }

            // For admin connections, check if authenticated
            // @ts-ignore: req.isAuthenticated is added by passport
            return req.isAuthenticated?.() || false;
        }
    });

    // Add request logging middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });

    // Setup authentication
    setupAuth(app);

    // Add password change endpoint
    app.post("/api/user/change-password", ensureAuthenticated, async (req: Request, res: Response) => {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: "Current password and new password are required" });
        }

        try {
            const [user] = await db.query.users.findMany({
                where: eq(users.id, req.user!.id),
                columns: {
                    password: true
                }
            });

            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            // Verify current password
            const [hashedCurrent, salt] = user.password.split('.');
            const hashedBuf = Buffer.from(hashedCurrent, 'hex');
            const suppliedBuf = (await scryptAsync(currentPassword, salt, 64)) as Buffer;

            if (!timingSafeEqual(hashedBuf, suppliedBuf)) {
                return res.status(400).json({ message: "Current password is incorrect" });
            }

            // Hash new password
            const newSalt = randomBytes(16).toString('hex');
            const newBuf = (await scryptAsync(newPassword, newSalt, 64)) as Buffer;
            const newHashedPassword = `${newBuf.toString('hex')}.${newSalt}`;

            // Update password
            await db.update(users)
                .set({ password: newHashedPassword })
                .where(eq(users.id, req.user!.id));

            res.json({ message: "Password updated successfully" });
        } catch (error) {
            console.error('Error updating password:', error);
            res.status(500).json({ message: "Failed to update password" });
        }
    });

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

    // Add the restaurant update endpoint
    app.patch("/api/restaurant", ensureAuthenticated, async (req: Request, res: Response) => {
        const { name, email, address, phone } = req.body;

        if (!name || typeof name !== 'string') {
            return res.status(400).json({ message: "Invalid restaurant name" });
        }

        try {
            // Get the user's first restaurant (current implementation supports one restaurant per user)
            const [restaurant] = await db.query.restaurants.findMany({
                where: eq(restaurants.ownerId, req.user!.id),
                limit: 1
            });

            if (!restaurant) {
                return res.status(404).json({ message: "Restaurant not found" });
            }

            // Update the restaurant details
            const [updatedRestaurant] = await db
                .update(restaurants)
                .set({
                    name,
                    email: email || null,
                    address: address || null,
                    phone: phone || null
                })
                .where(eq(restaurants.id, restaurant.id))
                .returning();

            res.json(updatedRestaurant);
        } catch (error) {
            console.error('Error updating restaurant:', error);
            res.status(500).json({ message: "Failed to update restaurant" });
        }
    });

    // Add account deletion endpoint
    app.delete("/api/user", ensureAuthenticated, async (req: Request, res: Response) => {
        try {
            // Get user's restaurant
            const [restaurant] = await db.query.restaurants.findMany({
                where: eq(restaurants.ownerId, req.user!.id)
            });

            if (restaurant) {
                // Delete all requests for the restaurant's tables
                const restaurantTables = await db.query.tables.findMany({
                    where: eq(tables.restaurantId, restaurant.id)
                });

                for (const table of restaurantTables) {
                    await db.delete(requests).where(eq(requests.tableId, table.id));
                    await db.delete(tableSessions).where(eq(tableSessions.tableId, table.id));
                }

                // Delete tables
                await db.delete(tables).where(eq(tables.restaurantId, restaurant.id));

                // Delete restaurant
                await db.delete(restaurants).where(eq(restaurants.id, restaurant.id));
            }

            // Delete user
            await db.delete(users).where(eq(users.id, req.user!.id));

            // Log the user out
            req.logout((err) => {
                if (err) {
                    console.error('Error logging out during account deletion:', err);
                }
                res.json({ message: "Account deleted successfully" });
            });
        } catch (error) {
            console.error('Error deleting account:', error);
            res.status(500).json({ message: "Failed to delete account" });
        }
    });

    // Table routes - all within restaurant context
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
            console.log('Generated table URL for QR:', {
                protocol,
                domain,
                restaurantId,
                tableId: table.id,
                fullUrl: tableUrl
            });

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
    app.get("/api/restaurants/:restaurantId/tables/:tableId/verify", async (req: Request, res: Response) => {
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

            // Check for active session - explicitly check endedAt is null
            const activeSession = await db.query.tableSessions.findFirst({
                where: and(
                    eq(tableSessions.tableId, Number(tableId)),
                    isNull(tableSessions.endedAt)
                ),
                orderBy: (sessions, { desc }) => [desc(sessions.startedAt)],
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

                    return res.json({
                        valid: true,
                        table,
                        shouldClearSession: true,
                        reason: 'expired'
                    });
                } else {
                    // Active session exists
                    return res.json({
                        valid: true,
                        table,
                        activeSession: {
                            id: activeSession.sessionId,
                            startedAt: activeSession.startedAt,
                            expiresIn: SESSION_DURATION - sessionAge
                        }
                    });
                }
            } else {
                // No active session found, allow creating a new one
                return res.json({
                    valid: true,
                    table,
                    requiresNewSession: true
                });
            }
        } catch (error) {
            console.error('Error verifying table:', error);
            res.status(500).json({ message: "Failed to verify table" });
        }
    });

    // Update validateSession middleware
    const validateSession = async (req: Request, res: Response, next: NextFunction) => {
        const { sessionId } = req.body;
        const tableId = Number(req.body.tableId || req.params.tableId);

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
                orderBy: (sessions, { desc }) => [desc(sessions.startedAt)],
            });

            if (!session) {
                // Clear client session if it's invalid
                return res.status(403).json({
                    message: "Invalid or expired session",
                    shouldClearSession: true
                });
            }

            // Check session expiry
            const SESSION_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
            const sessionStart = new Date(session.startedAt);
            const sessionAge = Date.now() - sessionStart.getTime();

            if (sessionAge > SESSION_DURATION) {
                await db.update(tableSessions)
                    .set({ endedAt: new Date() })
                    .where(eq(tableSessions.id, session.id));

                // Notify all clients about the expired session
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: "end_session",
                            tableId: session.tableId,
                            sessionId: session.sessionId,
                            reason: "expired"
                        }));
                    }
                });

                return res.status(403).json({
                    message: "Session expired",
                    shouldClearSession: true
                });
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

    // Update request endpoint to handle session data properly
    app.post("/api/requests", validateSession, async (req: Request, res: Response) => {
        const { type, notes } = req.body;
        const sessionId = req.session.sessionId;
        const tableId = req.session.tableId;

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

    // Fix table update query
    app.patch("/api/restaurants/:restaurantId/tables/:tableId", ensureAuthenticated, async (req: Request, res: Response) => {
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

    app.delete("/api/restaurants/:restaurantId/tables/:tableId", ensureAuthenticated, async (req: Request, res: Response) => {
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
    app.post("/api/restaurants/:restaurantId/tables/:tableId/sessions", async (req: Request, res: Response) => {
        try {
            const { restaurantId, tableId } = req.params;
            const sessionId = generateSessionId(); // Use the custom generator instead of nanoid()

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


    app.post("/api/restaurants/:restaurantId/tables/:tableId/sessions/end", async (req: Request, res: Response) => {
        const { restaurantId, tableId } = req.params;
        const { sessionId } = req.body;

        try {
            console.log('Session end requested:', {
                tableId: Number(tableId),
                sessionId,
                timestamp: new Date().toISOString()
            });

            // Broadcast session end to all connected clients immediately
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

            // Wait a moment to ensure clients receive the WebSocket message
            await new Promise(resolve => setTimeout(resolve, 500));

            // Close the session by setting endedAt
            await db.update(tableSessions)
                .set({ endedAt: new Date() })
                .where(and(
                    eq(tableSessions.tableId, Number(tableId)),
                    eq(tableSessions.sessionId, sessionId),
                    isNull(tableSessions.endedAt)
                ));

            // Close all pending and in-progress requests for this session
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

            console.log('Session ended, requests updated:', {
                tableId: Number(tableId),
                sessionId,
                updatedRequestsCount: updatedRequests.length
            });

            // Send request updates if there were any requests cleared
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

    app.get("/api/requests", async (req: Request, res: Response) => {
        const { tableId, sessionId } = req.query;

        try {
            // Get the user's restaurant if authenticated
            let restaurantId: number | undefined;
            if (req.isAuthenticated()) {
                const [restaurant] = await db.query.restaurants.findMany({
                    where: eq(restaurants.ownerId, req.user!.id),
                    limit: 1
                });
                restaurantId = restaurant?.id;
            }

            // Base query for requests with table info
            const baseQuery = {
                with: {
                    table: {
                        columns: {
                            id: true,
                            restaurantId: true,
                            name: true
                        }
                    }
                }
            };

            // Build conditions array
            let conditions = [];

            // Add table ID condition if provided
            if (tableId) {
                conditions.push(eq(requests.tableId, Number(tableId)));
            }

            // Add session ID condition if provided
            if (sessionId) {
                conditions.push(eq(requests.sessionId, sessionId as string));
            }

            // Add restaurant filter for authenticated users
            if (restaurantId) {
                const restaurantTables = await db.query.tables.findMany({
                    where: eq(tables.restaurantId, restaurantId),
                    columns: {
                        id: true
                    }
                });

                const tableIds = restaurantTables.map(t => t.id);
                if (tableIds.length > 0) {
                    conditions.push(inArray(requests.tableId, tableIds));
                } else {
                    // If restaurant has no tables, return empty array
                    return res.json([]);
                }
            }

            // Execute query with all conditions
            const allRequests = await db.query.requests.findMany({
                ...baseQuery,
                where: conditions.length > 0 ? and(...conditions) : undefined,
            });

            res.json(allRequests);
        } catch (error) {
            console.error('Error fetching requests:', error);
            res.status(500).json({ message: "Failed to fetch requests" });
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
            // Update all completed requests to be cleared
            const updatedRequests = await db
                .update(requests)
                .set({
                    status: "cleared",
                    completedAt: new Date()
                })
                .where(eq(requests.status, "completed"))
                .returning();

            // Broadcast the updates to all connected clients
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

    // Get table sessions for a restaurant
    app.get("/api/restaurants/:restaurantId/table-sessions", ensureAuthenticated, async (req: Request, res: Response) => {
        const { restaurantId } = req.params;

        try {
            // Get active sessions for tables in this restaurant
            const sessions = await db.query.tableSessions.findMany({
                where: isNull(tableSessions.endedAt),
                with: {
                    table: {
                        columns: {
                            id: true,
                            restaurantId: true
                        }
                    }
                }
            });

            // Filter sessions to only include those for tables in this restaurant
            const filteredSessions = sessions.filter(session =>
                session.table && session.table.restaurantId === Number(restaurantId)
            );

            res.json(filteredSessions);
        } catch (error) {
            console.error('Error fetching table sessions:', error);
            res.status(500).json({ message: "Failed to fetch table sessions" });
        }
    });

    app.get('/api/qr-test/:id', (req, res) => {
        const fullUrl = `${req.protocol}://${req.get('host')}/your-target-path/${req.params.id}`;
        console.log('QR Code URL:', fullUrl);
        res.send(`QR Code would redirect to: ${fullUrl}`);
    });

    return httpServer;
}