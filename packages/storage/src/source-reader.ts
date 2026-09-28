import {
  BookEdition,
  type BookEdition as BookEditionRecord,
  EditionId,
  GrantId,
  type TransmissionGrant as GrantRecord,
  InstallationId,
  type NormalizationRevision as NormalizationRecord,
  NormalizationRevision,
  NormalizationRevisionId,
  OwnerId,
  type StudySetupRevision as SetupRecord,
  SetupRevisionId,
  StudyId,
  StudySetupRevision,
  TransmissionGrant,
} from "@reading-studio/contracts"
import { asc, desc, eq, sql } from "drizzle-orm"
import type { StorageContext } from "./database.ts"
import { StoredRecordError } from "./errors.ts"
import { decodeRecord, parseInput } from "./records.ts"
import {
  bookEditions,
  installations,
  normalizationRevisions,
  setupRevisions,
  studies,
  transmissionGrants,
} from "./schema/index.ts"
import type { StudyRecord } from "./sources.ts"

export class SourceReader {
  constructor(private readonly context: StorageContext) {}

  getInstallation(input: unknown) {
    const ownerId = OwnerId.parse(input)
    const row = this.context.db
      .select()
      .from(installations)
      .where(eq(installations.ownerId, ownerId))
      .get()
    return row ? InstallationId.parse(row.id) : null
  }

  getLatestSetup(input: unknown): SetupRecord | null {
    const studyId = StudyId.parse(input)
    const row = this.context.db
      .select()
      .from(setupRevisions)
      .where(eq(setupRevisions.studyId, studyId))
      .orderBy(desc(sql`rowid`))
      .get()
    return row ? decodeRecord(StudySetupRevision, row.recordJson, "setup revision", row.id) : null
  }

  listDocuments(input: unknown) {
    const ownerId = parseInput(OwnerId, input, "owner ID")
    return this.context.db
      .selectDistinct({
        edition: bookEditions.recordJson,
        normalization: normalizationRevisions.recordJson,
        id: normalizationRevisions.id,
      })
      .from(studies)
      .innerJoin(bookEditions, eq(studies.editionId, bookEditions.id))
      .innerJoin(normalizationRevisions, eq(normalizationRevisions.editionId, bookEditions.id))
      .where(eq(studies.ownerId, ownerId))
      .orderBy(asc(bookEditions.id), asc(normalizationRevisions.id))
      .all()
      .map((row) => ({
        edition: decodeRecord(BookEdition, row.edition, "book edition", row.id),
        normalization: decodeRecord(
          NormalizationRevision,
          row.normalization,
          "normalization revision",
          row.id,
        ),
      }))
  }

  getEdition(input: unknown): BookEditionRecord | null {
    const id = parseInput(EditionId, input, "edition ID")
    const row = this.context.db.select().from(bookEditions).where(eq(bookEditions.id, id)).get()
    return row === undefined ? null : decodeRecord(BookEdition, row.recordJson, "book edition", id)
  }

  getNormalization(input: unknown): NormalizationRecord | null {
    const id = parseInput(NormalizationRevisionId, input, "normalization ID")
    const row = this.context.db
      .select()
      .from(normalizationRevisions)
      .where(eq(normalizationRevisions.id, id))
      .get()
    return row === undefined
      ? null
      : decodeRecord(NormalizationRevision, row.recordJson, "normalization revision", id)
  }

  getSetup(input: unknown): SetupRecord | null {
    const id = parseInput(SetupRevisionId, input, "setup ID")
    const row = this.context.db.select().from(setupRevisions).where(eq(setupRevisions.id, id)).get()
    return row === undefined
      ? null
      : decodeRecord(StudySetupRevision, row.recordJson, "setup revision", id)
  }

  getGrant(input: unknown): GrantRecord | null {
    const id = parseInput(GrantId, input, "grant ID")
    const row = this.context.db
      .select()
      .from(transmissionGrants)
      .where(eq(transmissionGrants.id, id))
      .get()
    return row === undefined
      ? null
      : decodeRecord(TransmissionGrant, row.recordJson, "transmission grant", id)
  }

  listStudiesByEdition(input: unknown): readonly StudyRecord[] {
    const editionId = parseInput(EditionId, input, "edition ID")
    return this.context.db
      .select()
      .from(studies)
      .where(eq(studies.editionId, editionId))
      .orderBy(asc(studies.id))
      .all()
      .map((row) => {
        try {
          return Object.freeze({
            id: StudyId.parse(row.id),
            ownerId: OwnerId.parse(row.ownerId),
            editionId: EditionId.parse(row.editionId),
          })
        } catch (error) {
          throw new StoredRecordError("study", row.id, { cause: error })
        }
      })
  }
}
