import { pgSchema, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

const mySchema = pgSchema("translationapp_coachunder");

export const translationSessionsTable = mySchema.table("translation_sessions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceLanguage: text("source_language").notNull().default("en"),
  targetLanguage: text("target_language").notNull(),
  targetLanguages: text("target_languages").array().notNull().default(["en"]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const translationLogsTable = mySchema.table("translation_logs", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => translationSessionsTable.id, { onDelete: "cascade" }),
  originalText: text("original_text").notNull(),
  translatedText: text("translated_text").notNull(),
  sourceLanguage: text("source_language").notNull(),
  targetLanguage: text("target_language").notNull(),
  speaker: text("speaker"),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const sessionListenersTable = mySchema.table("session_listeners", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => translationSessionsTable.id, { onDelete: "cascade" }),
  listenerName: varchar("listener_name").notNull(),
  targetLanguage: varchar("target_language").notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  leftAt: timestamp("left_at"),
});

export const insertSessionSchema = createInsertSchema(translationSessionsTable).omit({ id: true, createdAt: true });
export const insertLogSchema = createInsertSchema(translationLogsTable).omit({ id: true, timestamp: true });
export const insertListenerSchema = createInsertSchema(sessionListenersTable).omit({ id: true, joinedAt: true });

export type TranslationSession = typeof translationSessionsTable.$inferSelect;
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type TranslationLog = typeof translationLogsTable.$inferSelect;
export type InsertLog = z.infer<typeof insertLogSchema>;
export type SessionListener = typeof sessionListenersTable.$inferSelect;
export type InsertListener = z.infer<typeof insertListenerSchema>;
