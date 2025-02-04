import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users as usersTable } from "@db/schema";
import { db, pool } from "@db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface User {
      id: number;
      username: string;
      email: string;
      role: string;
      isAdmin: boolean;
      createdAt: Date;
    }
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
  console.log('Found user:', foundUsers[0]);
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
      sameSite: 'lax',
      httpOnly: true
    }
  };

  if (app.get("env") === "production") {
    app.set("trust proxy", 1);
    if (sessionSettings.cookie) {
      sessionSettings.cookie.secure = true;
    }
  }

  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        console.log('Login attempt for username:', username);
        const [user] = await getUserByUsername(username);
        if (!user) {
          console.log('User not found:', username);
          return done(null, false, { message: 'Invalid username or password' });
        }

        const passwordMatch = await comparePasswords(password, user.password);
        console.log('Password match result:', passwordMatch);

        if (!passwordMatch) {
          console.log('Password mismatch for user:', username);
          return done(null, false, { message: 'Invalid username or password' });
        }

        const { password: _, ...userWithoutPassword } = user;
        console.log('Login successful for user:', username);
        return done(null, userWithoutPassword);
      } catch (error) {
        console.error('Login error:', error);
        return done(error);
      }
    })
  );

  passport.serializeUser((user: Express.User, done) => {
    console.log('Serializing user:', user.id);
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log('Deserializing user:', id);
      const [user] = await db
        .select({
          id: usersTable.id,
          username: usersTable.username,
          email: usersTable.email,
          role: usersTable.role,
          isAdmin: usersTable.isAdmin,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable)
        .where(eq(usersTable.id, id))
        .limit(1);

      if (!user) {
        console.log('User not found during deserialization:', id);
        return done(null, false);
      }

      console.log('User deserialized successfully:', id);
      done(null, user);
    } catch (error) {
      console.error('Deserialization error:', error);
      done(error);
    }
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      const [existingUser] = await getUserByUsername(req.body.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const hashedPassword = await hashPassword(req.body.password);
      const [user] = await db
        .insert(usersTable)
        .values({
          username: req.body.username,
          password: hashedPassword,
          email: req.body.email,
          role: req.body.role || "user",
          isAdmin: req.body.role === "admin"
        })
        .returning();

      const { password: _, ...userWithoutPassword } = user;
      req.login(userWithoutPassword, (err) => {
        if (err) return next(err);
        res.status(201).json(userWithoutPassword);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      req.login(user, (err) => {
        if (err) return next(err);
        res.json(user);
      });
    })(req, res, next);
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.clearCookie('connect.sid');
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json(req.user);
  });
}