import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

export const tables = pgTable("tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  qrCode: text("qr_code").notNull(),
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

export const tableRelations = relations(tables, ({ many }) => ({
  sessions: many(tableSessions),
  requests: many(requests),
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

export const insertTableSchema = createInsertSchema(tables);
export const selectTableSchema = createSelectSchema(tables);
export const insertRequestSchema = createInsertSchema(requests);
export const selectRequestSchema = createSelectSchema(requests);
export const insertFeedbackSchema = createInsertSchema(feedback);
export const selectFeedbackSchema = createSelectSchema(feedback);

export type Table = typeof tables.$inferSelect;
export type TableSession = typeof tableSessions.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type Feedback = typeof feedback.$inferSelect;