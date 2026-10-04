import {
  BookEdition,
  LocatedSourceSpan,
  NormalizationRevision,
  NormalizedStudySetup,
  SourceSpan,
  StudySetupRevision,
} from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { digest } from "./backup-records.ts"
import { BackupError, columns, Row, tableNamed } from "./backup-schema.ts"

const JsonRow = z.object({ record_json: z.string() })
export function verifySourceGraph(sqlite: Database.Database): void {
  const normalizations = new Map<string, NormalizationRevision>()
  for (const raw of sqlite.prepare("SELECT record_json FROM normalization_revisions").all()) {
    const normalization = NormalizationRevision.parse(JSON.parse(JsonRow.parse(raw).record_json))
    normalizations.set(normalization.id, normalization)
    const editionRow = sqlite
      .prepare("SELECT record_json FROM book_editions WHERE id = ?")
      .get(normalization.editionId)
    const edition = BookEdition.parse(JSON.parse(JsonRow.parse(editionRow).record_json))
    if (edition.originalHash !== normalization.editionHash)
      throw new BackupError("normalization edition hash mismatch")
    const resources: Row[] = []
    const blocks: Row[] = []
    for (const [position, resource] of normalization.resources.entries()) {
      const base = {
        normalization_revision_id: normalization.id,
        edition_id: normalization.editionId,
        resource_path: resource.path,
      }
      resources.push({
        ...base,
        position,
        role: resource.role,
        status: resource.status,
        reason: resource.status === "excluded" ? resource.reason : null,
      })
      if (resource.status === "included") {
        for (const [blockPosition, block] of resource.blocks.entries()) {
          blocks.push({
            ...base,
            block_id: block.id,
            position: blockPosition,
            text: block.text,
            original_fragment: block.originalFragment ?? null,
            page_label: block.pageLabel ?? null,
          })
        }
      }
    }
    for (const [tableName, expected] of [
      ["normalization_resources", resources],
      ["source_blocks", blocks],
    ] as const) {
      const fields = columns(tableNamed(tableName))
      const actual = sqlite
        .prepare(
          `SELECT ${fields.join(",")} FROM ${tableName} WHERE normalization_revision_id = ? ORDER BY rowid`,
        )
        .all(normalization.id)
        .map((row) => Row.parse(row))
      const values = (rows: readonly Row[]) => rows.map((row) => fields.map((field) => row[field]))
      if (JSON.stringify(values(actual)) !== JSON.stringify(values(expected)))
        throw new BackupError("normalized source index disagrees with immutable record")
    }
  }
  for (const raw of sqlite.prepare("SELECT record_json FROM setup_revisions").all()) {
    const setup = StudySetupRevision.parse(JSON.parse(JsonRow.parse(raw).record_json))
    NormalizedStudySetup.parse({
      setup,
      normalization: normalizations.get(setup.analysis.normalizationRevisionId),
    })
  }
  for (const raw of sqlite.prepare("SELECT id, record_json FROM source_spans").all()) {
    const row = z.object({ id: z.string(), record_json: z.string() }).parse(raw)
    const span = SourceSpan.parse(JSON.parse(row.record_json))
    if (digest(row.record_json) !== row.id) throw new BackupError("source span digest mismatch")
    LocatedSourceSpan.parse({
      span,
      normalization: normalizations.get(span.normalizationRevisionId),
    })
  }
}
