import { foreignKey, primaryKey, sqliteTable, text, unique } from "drizzle-orm/sqlite-core"
import { normalizationRevisions, setupRevisions, studies } from "./source.ts"

export const analysisRevisions = sqliteTable(
  "analysis_revisions",
  {
    id: text("id").primaryKey(),
    editionId: text("edition_id").notNull(),
    normalizationRevisionId: text("normalization_revision_id").notNull(),
    parentRevisionId: text("parent_revision_id"),
    cacheKey: text("cache_key").notNull(),
    status: text("status", { enum: ["partial", "successful"] }).notNull(),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    unique("analysis_id_edition_unique").on(table.id, table.editionId),
    foreignKey({
      name: "analysis_normalization_edition_fk",
      columns: [table.normalizationRevisionId, table.editionId],
      foreignColumns: [normalizationRevisions.id, normalizationRevisions.editionId],
    }).onDelete("restrict"),
    foreignKey({
      name: "analysis_parent_edition_fk",
      columns: [table.parentRevisionId, table.editionId],
      foreignColumns: [table.id, table.editionId],
    }).onDelete("restrict"),
  ],
)

export const questionRevisions = sqliteTable(
  "question_revisions",
  {
    revisionId: text("revision_id").primaryKey(),
    questionId: text("question_id").notNull(),
    analysisRevisionId: text("analysis_revision_id")
      .notNull()
      .references(() => analysisRevisions.id, { onDelete: "restrict" }),
    parentRevisionId: text("parent_revision_id"),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    unique("question_revision_question_unique").on(table.revisionId, table.questionId),
    foreignKey({
      name: "question_parent_question_fk",
      columns: [table.parentRevisionId, table.questionId],
      foreignColumns: [table.revisionId, table.questionId],
    }).onDelete("restrict"),
  ],
)

export const inputRevisions = sqliteTable(
  "input_revisions",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "restrict" }),
    parentRevisionId: text("parent_revision_id"),
    kind: text("kind", { enum: ["answer", "setup"] }).notNull(),
  },
  (table) => [
    unique("input_id_study_unique").on(table.id, table.studyId),
    foreignKey({
      name: "input_parent_study_fk",
      columns: [table.parentRevisionId, table.studyId],
      foreignColumns: [table.id, table.studyId],
    }).onDelete("restrict"),
  ],
)

export const answerRevisions = sqliteTable(
  "answer_revisions",
  {
    id: text("id")
      .primaryKey()
      .references(() => inputRevisions.id, { onDelete: "restrict" }),
    questionRevisionId: text("question_revision_id").notNull(),
    questionId: text("question_id").notNull(),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    foreignKey({
      name: "answer_question_revision_fk",
      columns: [table.questionRevisionId, table.questionId],
      foreignColumns: [questionRevisions.revisionId, questionRevisions.questionId],
    }).onDelete("restrict"),
  ],
)

export const briefRevisions = sqliteTable(
  "brief_revisions",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "restrict" }),
    setupRevisionId: text("setup_revision_id")
      .notNull()
      .references(() => setupRevisions.id, { onDelete: "restrict" }),
    analysisRevisionId: text("analysis_revision_id")
      .notNull()
      .references(() => analysisRevisions.id, { onDelete: "restrict" }),
    parentRevisionId: text("parent_revision_id"),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    unique("brief_id_study_unique").on(table.id, table.studyId),
    foreignKey({
      name: "brief_parent_study_fk",
      columns: [table.parentRevisionId, table.studyId],
      foreignColumns: [table.id, table.studyId],
    }).onDelete("restrict"),
  ],
)

export const briefApprovals = sqliteTable("brief_approvals", {
  briefRevisionId: text("brief_revision_id")
    .primaryKey()
    .references(() => briefRevisions.id, { onDelete: "restrict" }),
  approvedAt: text("approved_at").notNull(),
  recordJson: text("record_json").notNull(),
})

export const outlineRevisions = sqliteTable(
  "outline_revisions",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "restrict" }),
    setupRevisionId: text("setup_revision_id")
      .notNull()
      .references(() => setupRevisions.id, { onDelete: "restrict" }),
    analysisRevisionId: text("analysis_revision_id")
      .notNull()
      .references(() => analysisRevisions.id, { onDelete: "restrict" }),
    briefRevisionId: text("brief_revision_id")
      .notNull()
      .references(() => briefRevisions.id, { onDelete: "restrict" }),
    parentRevisionId: text("parent_revision_id"),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    unique("outline_id_study_unique").on(table.id, table.studyId),
    foreignKey({
      name: "outline_parent_study_fk",
      columns: [table.parentRevisionId, table.studyId],
      foreignColumns: [table.id, table.studyId],
    }).onDelete("restrict"),
  ],
)

export const outlineApprovals = sqliteTable("outline_approvals", {
  outlineRevisionId: text("outline_revision_id")
    .primaryKey()
    .references(() => outlineRevisions.id, { onDelete: "restrict" }),
  approvedAt: text("approved_at").notNull(),
  recordJson: text("record_json").notNull(),
})

export const lessonRevisions = sqliteTable(
  "lesson_revisions",
  {
    id: text("id").primaryKey(),
    studyId: text("study_id")
      .notNull()
      .references(() => studies.id, { onDelete: "restrict" }),
    setupRevisionId: text("setup_revision_id")
      .notNull()
      .references(() => setupRevisions.id, { onDelete: "restrict" }),
    analysisRevisionId: text("analysis_revision_id")
      .notNull()
      .references(() => analysisRevisions.id, { onDelete: "restrict" }),
    briefRevisionId: text("brief_revision_id")
      .notNull()
      .references(() => briefRevisions.id, { onDelete: "restrict" }),
    outlineRevisionId: text("outline_revision_id")
      .notNull()
      .references(() => outlineRevisions.id, { onDelete: "restrict" }),
    parentRevisionId: text("parent_revision_id"),
    recordJson: text("record_json").notNull(),
  },
  (table) => [
    unique("lesson_id_study_unique").on(table.id, table.studyId),
    foreignKey({
      name: "lesson_parent_study_fk",
      columns: [table.parentRevisionId, table.studyId],
      foreignColumns: [table.id, table.studyId],
    }).onDelete("restrict"),
  ],
)

export const evidenceReports = sqliteTable("evidence_reports", {
  hash: text("hash").primaryKey(),
  lessonRevisionId: text("lesson_revision_id")
    .notNull()
    .references(() => lessonRevisions.id, { onDelete: "restrict" }),
  recordJson: text("record_json").notNull(),
})

export const privacyReviews = sqliteTable("privacy_reviews", {
  id: text("id").primaryKey(),
  projectionHash: text("projection_hash").notNull(),
  parentRevisionId: text("parent_revision_id").references(
    (): ReturnType<typeof text> => privacyReviews.id,
    { onDelete: "restrict" },
  ),
  status: text("status", { enum: ["passed", "blocked"] }).notNull(),
  recordJson: text("record_json").notNull(),
})

export const publicationRevisions = sqliteTable("publication_revisions", {
  id: text("id").primaryKey(),
  lessonRevisionId: text("lesson_revision_id")
    .notNull()
    .references(() => lessonRevisions.id, { onDelete: "restrict" }),
  analysisRevisionId: text("analysis_revision_id")
    .notNull()
    .references(() => analysisRevisions.id, { onDelete: "restrict" }),
  privacyReviewId: text("privacy_review_id")
    .notNull()
    .references(() => privacyReviews.id, { onDelete: "restrict" }),
  parentRevisionId: text("parent_revision_id").references(
    (): ReturnType<typeof text> => publicationRevisions.id,
    { onDelete: "restrict" },
  ),
  projectionHash: text("projection_hash").notNull(),
  recordJson: text("record_json").notNull(),
})

export const publicationApprovals = sqliteTable(
  "publication_approvals",
  {
    publicationRevisionId: text("publication_revision_id")
      .primaryKey()
      .references(() => publicationRevisions.id, { onDelete: "restrict" }),
    privacyReviewId: text("privacy_review_id")
      .notNull()
      .references(() => privacyReviews.id, { onDelete: "restrict" }),
    projectionHash: text("projection_hash").notNull(),
    approvedAt: text("approved_at").notNull(),
    recordJson: text("record_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.publicationRevisionId] })],
)
