import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  nickname: text("nickname").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("player"),
  banned: integer("banned").notNull().default(0),
  noteMuted: integer("note_muted").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});
export const characters = sqliteTable("characters", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id),
  progress: text("progress").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
