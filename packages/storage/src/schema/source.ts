import { sql } from "drizzle-orm"
import {
  check,
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core"

export const owners = sqliteTable(
  "owners",
  {
    id: text("id").primaryKey(),
    singleton: integer("singleton").default(1).notNull(),
  },
  (table) => [
    unique("owners_singleton_unique").on(table.singleton),
    check("owners_singleton_check", sql`${table.singleton} = 1`),
  ],
)

export const installations = sqliteTable(
  "installations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
  },
  (table) => [unique("installations_id_owner_unique").on(table.id, table.ownerId)],
)

export const bookEditions = sqliteTable("book_editions", {
  id: text("id").primaryKey(),
  originalHash: text("original_hash").notNull(),
  originalBlobHash: text("original_blob_hash").notNull(),
  title: text("title").notNull(),
  recordJson: text("record_json").notNull(),
})

export const studies = sqliteTable(
  "studies",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "restrict" }),
    editionId: text("edition_id")
      .notNull()
      .references(() => bookEditions.id, { onDelete: "restrict" }),
  },
  (table) => [unique("studies_id_edition_unique").on(table.id, table.editionId)],
)

export const normalizationRevisions = sqliteTable(
  "normalization_revisions",
  {
    id: text("id").primaryKey(),
    editionId: text("edition_id")
      .notNull()
      .references(() => bookEditions.id, { onDelete: "restrict" }),
    parentRevisionId: text("parent_revision_id"),
    editionHash: text("edition_hash").notNull(),
    parserVersion: text("parser_version").notNull(),
    normalizerVersion: text("normalizer_version").notNull(),
    coverage: text("coverage", { enum: ["complete", "partial"] }).notNull(),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    unique("normalization_id_edition_unique").on(table.id, table.editionId),
    foreignKey({
      name: "normalization_parent_edition_fk",
      columns: [table.parentRevisionId, table.editionId],
      foreignColumns: [table.id, table.editionId],
    }).onDelete("restrict"),
  ],
)

export const normalizationResources = sqliteTable(
  "normalization_resources",
  {
    normalizationRevisionId: text("normalization_revision_id").notNull(),
    editionId: text("edition_id").notNull(),
    resourcePath: text("resource_path").notNull(),
    position: integer("position").notNull(),
    role: text("role", { enum: ["main-chapter", "supplementary"] }).notNull(),
    status: text("status", { enum: ["included", "excluded"] }).notNull(),
    reason: text("reason"),
  },
  (table) => [
    primaryKey({ columns: [table.normalizationRevisionId, table.resourcePath] }),
    unique("normalization_resource_edition_unique").on(
      table.normalizationRevisionId,
      table.editionId,
      table.resourcePath,
    ),
    foreignKey({
      name: "normalization_resource_revision_fk",
      columns: [table.normalizationRevisionId, table.editionId],
      foreignColumns: [normalizationRevisions.id, normalizationRevisions.editionId],
    }).onDelete("restrict"),
  ],
)

export const sourceBlocks = sqliteTable(
  "source_blocks",
  {
    normalizationRevisionId: text("normalization_revision_id").notNull(),
    editionId: text("edition_id").notNull(),
    resourcePath: text("resource_path").notNull(),
    blockId: text("block_id").notNull(),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    originalFragment: text("original_fragment"),
    pageLabel: text("page_label"),
  },
  (table) => [
    primaryKey({ columns: [table.normalizationRevisionId, table.blockId] }),
    foreignKey({
      name: "source_block_resource_fk",
      columns: [table.normalizationRevisionId, table.editionId, table.resourcePath],
      foreignColumns: [
        normalizationResources.normalizationRevisionId,
        normalizationResources.editionId,
        normalizationResources.resourcePath,
      ],
    }).onDelete("restrict"),
  ],
)

export const setupRevisions = sqliteTable(
  "setup_revisions",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id").notNull(),
    editionId: text("edition_id").notNull(),
    normalizationRevisionId: text("normalization_revision_id").notNull(),
    parentRevisionId: text("parent_revision_id"),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    unique("setup_id_study_unique").on(table.id, table.studyId),
    foreignKey({
      name: "setup_study_edition_fk",
      columns: [table.studyId, table.editionId],
      foreignColumns: [studies.id, studies.editionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "setup_normalization_edition_fk",
      columns: [table.normalizationRevisionId, table.editionId],
      foreignColumns: [normalizationRevisions.id, normalizationRevisions.editionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "setup_parent_study_fk",
      columns: [table.parentRevisionId, table.studyId],
      foreignColumns: [table.id, table.studyId],
    }).onDelete("restrict"),
  ],
)

export const transmissionGrants = sqliteTable(
  "transmission_grants",
  {
    id: text("id").primaryKey(),
    setupRevisionId: text("setup_revision_id")
      .notNull()
      .references(() => setupRevisions.id, { onDelete: "restrict" }),
    installationId: text("installation_id").notNull(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind", { enum: ["active", "historical", "revoked"] }).notNull(),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    unique("grant_id_setup_unique").on(table.id, table.setupRevisionId),
    foreignKey({
      name: "grant_installation_owner_fk",
      columns: [table.installationId, table.ownerId],
      foreignColumns: [installations.id, installations.ownerId],
    }).onDelete("restrict"),
  ],
)
