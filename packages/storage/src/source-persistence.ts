import { createHash } from "node:crypto"
import {
  BookEdition,
  Digest,
  LocatedSourceSpan,
  NormalizationRevision,
  SourceSpan,
  TransmissionGrant,
} from "@reading-studio/contracts"
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import { decodeRecord, encodeRecord, parseInput, writeRecord } from "./records.ts"
import { transmissionGrants } from "./schema/source.ts"
import { sourceSpans } from "./schema/source-spans.ts"
import type { SourceRepository } from "./sources.ts"

const Document = z.strictObject({ edition: BookEdition, normalization: NormalizationRevision })

export class SourcePersistence {
  constructor(
    private readonly context: StorageContext,
    private readonly sources: SourceRepository,
  ) {}

  appendGrant(input: unknown) {
    const record = parseInput(TransmissionGrant, input, "transmission grant")
    return writeRecord("transmission grant", record.id, () => {
      this.context.db
        .insert(transmissionGrants)
        .values({
          id: record.id,
          setupRevisionId: record.setupRevisionId,
          installationId: record.installationId,
          ownerId: record.ownerId,
          kind: record.kind,
          recordJson: encodeRecord(record),
        })
        .run()
      return record
    })
  }

  persistDocument(input: unknown) {
    const document = parseInput(Document, input, "source document")
    if (
      document.edition.id !== document.normalization.editionId ||
      document.edition.originalHash !== document.normalization.editionHash
    )
      throw new ContractBoundaryError("source document lineage")
    return this.context.db.transaction(
      () => {
        const edition =
          this.sources.getEdition(document.edition.id) ??
          this.sources.appendEdition(document.edition)
        if (edition.originalHash !== document.edition.originalHash)
          throw new ContractBoundaryError("source edition identity")
        const existing = this.sources.getNormalization(document.normalization.id)
        if (existing && encodeRecord(existing) !== encodeRecord(document.normalization))
          throw new ContractBoundaryError("source normalization identity")
        const normalization =
          existing ??
          this.sources.appendNormalization({
            record: document.normalization,
            parentRevisionId: null,
          })
        return { edition, normalization }
      },
      { behavior: "immediate" },
    )
  }

  appendSpan(input: unknown): Digest {
    const span = parseInput(SourceSpan, input, "source span")
    this.locate(span)
    const recordJson = encodeRecord(span)
    const id = Digest.parse(createHash("sha256").update(recordJson).digest("hex"))
    return writeRecord("source span", id, () => {
      this.context.db
        .insert(sourceSpans)
        .values({
          id,
          normalizationRevisionId: span.normalizationRevisionId,
          blockId: span.blockId,
          recordJson,
        })
        .onConflictDoNothing()
        .run()
      return id
    })
  }

  resolveSpan(input: unknown) {
    const id = parseInput(Digest, input, "source span ID")
    const row = this.context.db.select().from(sourceSpans).where(eq(sourceSpans.id, id)).get()
    if (!row) return null
    const span = decodeRecord(SourceSpan, row.recordJson, "source span", id)
    return { span, text: this.locate(span) }
  }

  private locate(span: SourceSpan): string {
    const normalization = this.sources.getNormalization(span.normalizationRevisionId)
    if (!normalization) throw new ContractBoundaryError("source span normalization")
    parseInput(LocatedSourceSpan, { normalization, span }, "source span locator")
    const resource = normalization.resources.find((item) => item.path === span.resourcePath)
    const block =
      resource?.status === "included"
        ? resource.blocks.find((item) => item.id === span.blockId)
        : undefined
    if (
      !block ||
      (span.originalFragment !== block.text.slice(span.start, span.end) &&
        span.originalFragment !== (block.originalFragment ?? resource?.path)) ||
      span.pageLabel !== block.pageLabel
    )
      throw new ContractBoundaryError("source span metadata")
    return block.text.slice(span.start, span.end)
  }
}
