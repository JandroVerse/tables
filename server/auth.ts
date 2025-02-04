import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users as usersTable, type User } from "@db/schema";
import { db, pool } from "@db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface User extends User {}
  }
}

const scryptAsync = promisify(scrypt);
const PostgresSessionStore = connectPg(session);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

async function getUserByUsername(username: string) {
  const foundUsers = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  console.log('Found user:', foundUsers[0]); // Add logging
  return foundUsers;
}

export function setupAuth(app: Express) {
  const store = new PostgresSessionStore({ 
    pool, 
    createTableIfMissing: true,
    ttl: 24 * 60 * 60 // Session expires in 24 hours
  });

  const sessionSettings: session.SessionOptions = {
    secret: process.env.REPL_ID!,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      secure: app.get("env") === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    }
  };

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        console.log('Login attempt for username:', username); // Add logging
        const [user] = await getUserByUsername(username);
        if (!user) {
          console.log('User not found:', username); // Add logging
          return done(null, false);
        }

        const passwordMatch = await comparePasswords(password, user.password);
        console.log('Password match result:', passwordMatch); // Add logging

        if (!passwordMatch) {
          console.log('Password mismatch for user:', username); // Add logging
          return done(null, false);
        }

        console.log('Login successful for user:', username); // Add logging
        return done(null, user);
      } catch (error) {
        console.error('Login error:', error); // Add logging
        return done(error);
      }
    }),
  );

  passport.serializeUser((user: any, done) => {
    console.log('Serializing user:', user.id); // Add logging
    done(null, user.id)
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log('Deserializing user:', id); // Add logging
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, id))
        .limit(1);

      if (!user) {
        console.log('User not found during deserialization:', id); // Add logging
        return done(null, false);
      }
      console.log('User deserialized successfully:', id); // Add logging
      done(null, user);
    } catch (error) {
      console.error('Deserialization error:', error); // Add logging
      done(error);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      // Validate username uniqueness
      const [existingUser] = await getUserByUsername(req.body.username);
      if (existingUser) {
        return res.status(400).send("Username already exists");
      }

      // Validate role
      const role = req.body.role || "user";
      if (!["user", "admin"].includes(role)) {
        return res.status(400).send("Invalid role. Must be either 'user' or 'admin'");
      }

      // Create user with new fields
      const [user] = await db
        .insert(usersTable)
        .values({
          username: req.body.username,
          password: await hashPassword(req.body.password),
          email: req.body.email || null, // Optional email
          role: role,
          isActive: true, // Default to active
          // createdAt and updatedAt are handled by default values
        })
        .returning();

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(user);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    console.log('Login successful, user:', req.user); // Add logging
    res.status(200).json(req.user);
  });

  app.post("/api/logout", (req, res, next) => {
    // Destroy the session completely
    req.session.destroy((err) => {
      if (err) return next(err);
      // Clear the client-side session cookie
      res.clearCookie('connect.sid');
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    res.json(req.user);
  });
}