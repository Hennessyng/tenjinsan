import { sql } from "drizzle-orm"
import { check, index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"
import { owners } from "./source.ts"

const timestamp = (name: string) =>
  integer(name, { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull()

export const authUsers = sqliteTable(
  "auth_users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
    singleton: integer("singleton").default(1).notNull(),
  },
  (table) => [
    unique("auth_users_singleton_unique").on(table.singleton),
    check("auth_users_singleton_check", sql`${table.singleton} = 1`),
  ],
)

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [index("auth_sessions_user_id_index").on(table.userId)],
)

export const authAccounts = sqliteTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (table) => [index("auth_accounts_user_id_index").on(table.userId)],
)

export const authVerifications = sqliteTable(
  "auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
  },
  (table) => [index("auth_verifications_identifier_index").on(table.identifier)],
)

export const authSchema = {
  account: authAccounts,
  session: authSessions,
  user: authUsers,
  verification: authVerifications,
} as const

export const authOwnerTriggerTarget = owners
