import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const requestLimits = sqliteTable("request_limits", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull().default(1),
  resetAt: integer("reset_at").notNull(),
}, table => [index("request_limits_reset_at_idx").on(table.resetAt)]);
