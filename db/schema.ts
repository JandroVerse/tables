import { pgTable, text, serial, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";

export const tables = pgTable("tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "Table 1", "Table 2"
  qrCode: text("qr_code").notNull(),
});

export const requests = pgTable("requests", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").references(() => tables.id).notNull(),
  type: text("type", { enum: ["waiter", "water", "check", "other"] }).notNull(),
  status: text("status", { enum: ["pending", "in_progress", "completed"] }).default("pending").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const tableRelations = relations(tables, ({ many }) => ({
  requests: many(requests),
}));

export const requestRelations = relations(requests, ({ one }) => ({
  table: one(tables, {
    fields: [requests.tableId],
    references: [tables.id],
  }),
}));

export const insertTableSchema = createInsertSchema(tables);
export const selectTableSchema = createSelectSchema(tables);
export const insertRequestSchema = createInsertSchema(requests);
export const selectRequestSchema = createSelectSchema(requests);

export type Table = typeof tables.$inferSelect;
export type Request = typeof requests.$inferSelect;
