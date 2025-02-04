import { pgTable, text, serial, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ["owner", "staff"] }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const restaurants = pgTable("restaurants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ownerId: integer("owner_id").references(() => users.id).notNull(),
  address: text("address"),
  phone: text("phone"),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const restaurantStaff = pgTable("restaurant_staff", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  role: text("role", { enum: ["manager", "server", "host"] }).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tables = pgTable("tables", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  name: text("name").notNull(),
  qrCode: text("qr_code").notNull(),
  position: jsonb("position").default({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    shape: "square"
  }),
});

export const floorPlan = pgTable("floor_plan", {
  id: serial("id").primaryKey(),
  restaurantId: integer("restaurant_id").references(() => restaurants.id).notNull(),
  name: text("name").notNull(),
  dimensions: jsonb("dimensions").notNull(),
  sections: jsonb("sections").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tableSessions = pgTable("table_sessions", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").references(() => tables.id).notNull(),
  sessionId: text("session_id").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
});

export const requests = pgTable("requests", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").references(() => tables.id).notNull(),
  sessionId: text("session_id").notNull(),
  type: text("type", { enum: ["waiter", "water", "check", "other"] }).notNull(),
  status: text("status", { enum: ["pending", "in_progress", "completed", "cleared"] }).default("pending").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").references(() => requests.id).notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Relations
export const userRelations = relations(users, ({ many }) => ({
  ownedRestaurants: many(restaurants),
  staffAssignments: many(restaurantStaff),
}));

export const restaurantRelations = relations(restaurants, ({ one, many }) => ({
  owner: one(users, {
    fields: [restaurants.ownerId],
    references: [users.id],
  }),
  staff: many(restaurantStaff),
  tables: many(tables),
  floorPlans: many(floorPlan),
}));

export const restaurantStaffRelations = relations(restaurantStaff, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [restaurantStaff.restaurantId],
    references: [restaurants.id],
  }),
  user: one(users, {
    fields: [restaurantStaff.userId],
    references: [users.id],
  }),
}));

export const tableRelations = relations(tables, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [tables.restaurantId],
    references: [restaurants.id],
  }),
  sessions: many(tableSessions),
  requests: many(requests),
  floorPlan: one(floorPlan),
}));

export const floorPlanRelations = relations(floorPlan, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [floorPlan.restaurantId],
    references: [restaurants.id],
  }),
  tables: many(tables),
}));

export const tableSessionRelations = relations(tableSessions, ({ one, many }) => ({
  table: one(tables, {
    fields: [tableSessions.tableId],
    references: [tables.id],
  }),
  requests: many(requests),
}));


export const requestRelations = relations(requests, ({ one, many }) => ({
  table: one(tables, {
    fields: [requests.tableId],
    references: [tables.id],
  }),
  feedback: many(feedback),
}));

export const feedbackRelations = relations(feedback, ({ one }) => ({
  request: one(requests, {
    fields: [feedback.requestId],
    references: [requests.id],
  }),
}));

// Schemas for validation
export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const insertRestaurantSchema = createInsertSchema(restaurants);
export const selectRestaurantSchema = createSelectSchema(restaurants);
export const insertTableSchema = createInsertSchema(tables);
export const selectTableSchema = createSelectSchema(tables);
export const insertRequestSchema = createInsertSchema(requests);
export const selectRequestSchema = createSelectSchema(requests);
export const insertFeedbackSchema = createInsertSchema(feedback);
export const selectFeedbackSchema = createSelectSchema(feedback);
export const insertFloorPlanSchema = createInsertSchema(floorPlan);
export const selectFloorPlanSchema = createSelectSchema(floorPlan);

// Types
export type User = typeof users.$inferSelect;
export type Restaurant = typeof restaurants.$inferSelect;
export type RestaurantStaff = typeof restaurantStaff.$inferSelect;
export type Table = typeof tables.$inferSelect;
export type TableSession = typeof tableSessions.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;
export type FloorPlan = typeof floorPlan.$inferSelect;