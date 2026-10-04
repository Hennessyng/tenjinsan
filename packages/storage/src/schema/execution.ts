import { blob, foreignKey, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"
import { setupRevisions, transmissionGrants } from "./source.ts"
import { inputRevisions, publicationRevisions } from "./workflow.ts"

export const generationRuns = sqliteTable(
  "generation_runs",
  {
    id: text("id").primaryKey(),
    inputRevisionId: text("input_revision_id")
      .notNull()
      .references(() => inputRevisions.id, { onDelete: "restrict" }),
    state: text("state", {
      enum: ["running", "paused", "cancelled", "completed", "failed"],
    }).notNull(),
    reservedCalls: integer("reserved_calls").notNull().default(0),
    recordJson: text("record_json").notNull(),
  },
  (table) => [unique("run_id_input_unique").on(table.id, table.inputRevisionId)],
)

export const externalAttempts = sqliteTable(
  "external_attempts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    inputRevisionId: text("input_revision_id").notNull(),
    state: text("state", {
      enum: ["prepared", "dispatching", "response-received", "outcome_unknown"],
    }).notNull(),
    reservation: integer("reservation").notNull().default(0),
    responseBody: blob("response_body", { mode: "buffer" }),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    foreignKey({
      name: "attempt_run_input_fk",
      columns: [table.runId, table.inputRevisionId],
      foreignColumns: [generationRuns.id, generationRuns.inputRevisionId],
    }).onDelete("restrict"),
    unique("attempt_run_reservation_unique").on(table.runId, table.reservation),
  ],
)

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    inputRevisionId: text("input_revision_id").notNull(),
    setupRevisionId: text("setup_revision_id").notNull(),
    grantId: text("grant_id").notNull(),
    state: text("state", {
      enum: ["queued", "running", "paused", "failed", "completed", "cancelled"],
    }).notNull(),
    checkpoint: text("checkpoint"),
    cancellationRequested: integer("cancellation_requested", { mode: "boolean" })
      .notNull()
      .default(false),
    leaseFence: integer("lease_fence").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    foreignKey({
      name: "job_run_input_fk",
      columns: [table.runId, table.inputRevisionId],
      foreignColumns: [generationRuns.id, generationRuns.inputRevisionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "job_grant_setup_fk",
      columns: [table.grantId, table.setupRevisionId],
      foreignColumns: [transmissionGrants.id, transmissionGrants.setupRevisionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "job_setup_fk",
      columns: [table.setupRevisionId],
      foreignColumns: [setupRevisions.id],
    }).onDelete("restrict"),
  ],
)

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  publicationRevisionId: text("publication_revision_id")
    .notNull()
    .references(() => publicationRevisions.id, { onDelete: "restrict" }),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "restrict" }),
  contentHash: text("content_hash").notNull(),
  recordJson: text("record_json").notNull(),
})
