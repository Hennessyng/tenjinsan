import { AttemptId, Digest, RunId, SetupRevisionId, StudyId } from "@reading-studio/contracts"
import { z } from "zod"
import { Row } from "./backup-row.ts"

export const FullBookAudit = z
  .strictObject({
    version: z.literal("full-book-audit-1"),
    authority: z.literal("historical-audit-only"),
    consent: Row,
    closure: Row,
    study: Row,
    setupJson: z.string(),
    jobs: z.array(Row),
    runs: z.array(Row),
    attempts: z.array(Row),
    wires: z.array(Row),
    events: z.array(Row),
    replies: z.array(Row),
    receipts: z.array(Row),
    notNeeded: z.array(Row).optional(),
    managed: z
      .strictObject({
        consents: z.array(Row),
        revocations: z.array(Row),
        threads: z.array(Row),
        frames: z.array(Row),
        failures: z.array(Row),
      })
      .optional(),
  })
  .readonly()
export type FullBookAudit = z.infer<typeof FullBookAudit>
export const FullBookImport = z
  .strictObject({
    id: Digest,
    auditBlobHash: Digest,
    version: z.literal("full-book-audit-1"),
    authority: z.literal("historical-audit-only"),
    ownerHandle: z.literal("historical-owner"),
    sourceHash: Digest,
    studyId: StudyId,
    setupRevisionId: SetupRevisionId,
    consentId: z.uuid(),
    budgetVersion: z.number().int().positive(),
    spent: z.number().int().nonnegative(),
    held: z.literal(0),
    originalReservedCalls: z.number().int().positive(),
    attemptIds: z.array(AttemptId).max(10_000).readonly(),
    runIds: z.array(RunId).max(10_000).readonly(),
  })
  .refine(
    (value) =>
      value.id === value.auditBlobHash &&
      value.spent === value.attemptIds.length &&
      new Set(value.attemptIds).size === value.attemptIds.length &&
      new Set(value.runIds).size === value.runIds.length,
    "historical audit identity/counter mismatch",
  )
  .readonly()
export type FullBookImport = z.infer<typeof FullBookImport>
export const FULL_BOOK_IMPORT_TABLE = {
  name: "full_book_imports",
  columns:
    "id owner_id source_hash study_id setup_revision_id consent_id budget_version# spent# held# record_json",
  record: FullBookImport,
} as const
