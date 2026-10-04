import {
  BookEdition,
  type BookEdition as BookEditionRecord,
  EditionId,
  type TransmissionGrant as GrantRecord,
  InstallationId,
  type NormalizationRevision as NormalizationRecord,
  NormalizationRevision,
  NormalizationRevisionId,
  NormalizedStudySetup,
  OwnerId,
  type StudySetupRevision as SetupRecord,
  SetupRevisionId,
  StudyId,
  StudySetupRevision,
} from "@reading-studio/contracts"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import { encodeRecord, parseInput, readProperty, writeRecord } from "./records.ts"
import {
  bookEditions,
  installations,
  normalizationResources,
  normalizationRevisions,
  owners,
  setupRevisions,
  sourceBlocks,
  studies,
} from "./schema/index.ts"
import { SourcePersistence } from "./source-persistence.ts"
import { SourceReader } from "./source-reader.ts"

export type StudyRecord = {
  readonly id: ReturnType<typeof StudyId.parse>
  readonly ownerId: ReturnType<typeof OwnerId.parse>
  readonly editionId: ReturnType<typeof EditionId.parse>
}

export interface SourceRepository {
  getInstallation(input: unknown): ReturnType<SourceReader["getInstallation"]>
  getLatestSetup(input: unknown): SetupRecord | null
  listDocuments(input: unknown): ReturnType<SourceReader["listDocuments"]>
  persistDocument(input: unknown): ReturnType<SourcePersistence["persistDocument"]>
  appendSpan(input: unknown): ReturnType<SourcePersistence["appendSpan"]>
  resolveSpan(input: unknown): ReturnType<SourcePersistence["resolveSpan"]>
  createOwner(input: unknown): ReturnType<typeof OwnerId.parse>
  createInstallation(input: unknown): ReturnType<typeof InstallationId.parse>
  appendEdition(input: unknown): BookEditionRecord
  createStudy(input: unknown): StudyRecord
  appendNormalization(input: unknown): NormalizationRecord
  appendSetup(input: unknown): SetupRecord
  appendGrant(input: unknown): GrantRecord
  getEdition(input: unknown): BookEditionRecord | null
  getNormalization(input: unknown): NormalizationRecord | null
  getSetup(input: unknown): SetupRecord | null
  getGrant(input: unknown): GrantRecord | null
  listStudiesByEdition(input: unknown): readonly StudyRecord[]
}

export class SqliteSourceRepository implements SourceRepository {
  readonly #reader: SourceReader
  readonly #persistence: SourcePersistence

  constructor(private readonly context: StorageContext) {
    this.#reader = new SourceReader(context)
    this.#persistence = new SourcePersistence(context, this)
  }

  persistDocument(input: unknown) {
    return this.#persistence.persistDocument(input)
  }
  appendSpan(input: unknown) {
    return this.#persistence.appendSpan(input)
  }
  resolveSpan(input: unknown) {
    return this.#persistence.resolveSpan(input)
  }

  listDocuments(input: unknown) {
    return this.#reader.listDocuments(input)
  }

  createOwner(input: unknown): ReturnType<typeof OwnerId.parse> {
    const id = parseInput(OwnerId, input, "owner ID")
    return writeRecord("owner", id, () => {
      this.context.db.insert(owners).values({ id }).run()
      return id
    })
  }

  createInstallation(input: unknown): ReturnType<typeof InstallationId.parse> {
    const id = parseInput(
      InstallationId,
      readProperty(input, "installation", "id"),
      "installation ID",
    )
    const ownerId = parseInput(OwnerId, readProperty(input, "installation", "ownerId"), "owner ID")
    return writeRecord("installation", id, () => {
      this.context.db.insert(installations).values({ id, ownerId }).run()
      return id
    })
  }

  appendEdition(input: unknown): BookEditionRecord {
    const record = parseInput(BookEdition, input, "book edition")
    return writeRecord("book edition", record.id, () => {
      this.context.db
        .insert(bookEditions)
        .values({
          id: record.id,
          originalHash: record.originalHash,
          originalBlobHash: record.originalBlobHash,
          title: record.title,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  createStudy(input: unknown): StudyRecord {
    const record = {
      id: parseInput(StudyId, readProperty(input, "study", "id"), "study ID"),
      ownerId: parseInput(OwnerId, readProperty(input, "study", "ownerId"), "owner ID"),
      editionId: parseInput(EditionId, readProperty(input, "study", "editionId"), "edition ID"),
    }
    return writeRecord("study", record.id, () => {
      this.context.db.insert(studies).values(record).run()
      return Object.freeze(record)
    })
  }

  appendNormalization(input: unknown): NormalizationRecord {
    const rawParent = readProperty(input, "normalization write", "parentRevisionId")
    const record = parseInput(
      NormalizationRevision,
      readProperty(input, "normalization write", "record"),
      "normalization revision",
    )
    const parentRevisionId =
      rawParent === null
        ? null
        : parseInput(NormalizationRevisionId, rawParent, "parent normalization ID")
    const edition = this.getEdition(record.editionId)
    if (edition === null || edition.originalHash !== record.editionHash) {
      throw new ContractBoundaryError("normalization edition lineage")
    }
    return writeRecord("normalization revision", record.id, () => {
      this.context.db.transaction((transaction) => {
        transaction
          .insert(normalizationRevisions)
          .values({
            id: record.id,
            editionId: record.editionId,
            parentRevisionId,
            editionHash: record.editionHash,
            parserVersion: record.parserVersion,
            normalizerVersion: record.normalizerVersion,
            coverage: record.coverage,
            recordJson: encodeRecord(record),
          })
          .run()
        for (const [resourcePosition, resource] of record.resources.entries()) {
          transaction
            .insert(normalizationResources)
            .values({
              normalizationRevisionId: record.id,
              editionId: record.editionId,
              resourcePath: resource.path,
              position: resourcePosition,
              role: resource.role,
              status: resource.status,
              reason: resource.status === "excluded" ? resource.reason : null,
            })
            .run()
          if (resource.status === "included") {
            for (const [blockPosition, block] of resource.blocks.entries()) {
              transaction
                .insert(sourceBlocks)
                .values({
                  normalizationRevisionId: record.id,
                  editionId: record.editionId,
                  resourcePath: resource.path,
                  blockId: block.id,
                  position: blockPosition,
                  text: block.text,
                  originalFragment: block.originalFragment ?? null,
                  pageLabel: block.pageLabel ?? null,
                })
                .run()
            }
          }
        }
      })
      return record
    })
  }

  appendSetup(input: unknown): SetupRecord {
    const rawParent = readProperty(input, "setup write", "parentRevisionId")
    const record = parseInput(
      StudySetupRevision,
      readProperty(input, "setup write", "record"),
      "study setup revision",
    )
    const parentRevisionId =
      rawParent === null ? null : parseInput(SetupRevisionId, rawParent, "parent setup ID")
    const normalization = this.getNormalization(record.analysis.normalizationRevisionId)
    if (normalization === null) throw new ContractBoundaryError("setup normalization lineage")
    parseInput(NormalizedStudySetup, { setup: record, normalization }, "normalized study setup")
    return writeRecord("setup revision", record.id, () => {
      this.context.db
        .insert(setupRevisions)
        .values({
          id: record.id,
          studyId: record.studyId,
          editionId: record.editionId,
          normalizationRevisionId: record.analysis.normalizationRevisionId,
          parentRevisionId,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  appendGrant(input: unknown): GrantRecord {
    return this.#persistence.appendGrant(input)
  }

  getEdition(input: unknown): BookEditionRecord | null {
    return this.#reader.getEdition(input)
  }

  getNormalization(input: unknown): NormalizationRecord | null {
    return this.#reader.getNormalization(input)
  }

  getSetup(input: unknown): SetupRecord | null {
    return this.#reader.getSetup(input)
  }

  getGrant(input: unknown): GrantRecord | null {
    return this.#reader.getGrant(input)
  }

  listStudiesByEdition(input: unknown): readonly StudyRecord[] {
    return this.#reader.listStudiesByEdition(input)
  }

  getInstallation(input: unknown) {
    return this.#reader.getInstallation(input)
  }
  getLatestSetup(input: unknown) {
    return this.#reader.getLatestSetup(input)
  }
}
