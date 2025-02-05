import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { db } from "@db";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { setupAuth } from "./auth";

function ensureAuthenticated(req: Request, res: Response, next: Function) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Not authenticated" });
}

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  // Setup authentication
  setupAuth(app);

  // User management routes
  app.delete("/api/users/:id", ensureAuthenticated, async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      // Only owner users can delete users
      if (req.user?.role !== "owner") {
        return res.status(403).json({ message: "Only owners can delete users" });
      }

      // Prevent self-deletion
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

  return httpServer;
}