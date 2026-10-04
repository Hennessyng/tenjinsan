import { createHash, randomUUID } from "node:crypto"
import {
  ApprovedArtifact,
  Artifact,
  JobId,
  PUBLICATION_RENDERER,
  PublicationOutput,
  PublicationRevisionId,
  PublicationSnapshot,
  StudyId,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { ContractBoundaryError } from "./errors.ts"
import type { OutlineRepository } from "./outlines.ts"
import { ReviewRepository } from "./reviews.ts"
import type { PublicationRepository } from "./workflow-publication.ts"

const rowSchema = z.object({ record_json: z.string() })

export class PublicationOutputs {
  constructor(
    private readonly context: StorageContext,
    private readonly publications: PublicationRepository,
    private readonly outlines: OutlineRepository,
  ) {}

  list(study: unknown): readonly PublicationSnapshot[] {
    return this.context.sqlite
      .prepare(
        "SELECT record_json FROM publication_snapshots WHERE study_id = ? ORDER BY rowid DESC",
      )
      .all(StudyId.parse(study))
      .map((row) => PublicationSnapshot.parse(JSON.parse(rowSchema.parse(row).record_json)))
  }

  get(input: unknown): PublicationSnapshot | null {
    const row = this.context.sqlite
      .prepare("SELECT record_json FROM publication_snapshots WHERE publication_id = ?")
      .get(PublicationRevisionId.parse(input))
    return row ? PublicationSnapshot.parse(JSON.parse(rowSchema.parse(row).record_json)) : null
  }

  current(snapshot: PublicationSnapshot): boolean {
    const reviews = new ReviewRepository(this.context)
    const { publication, evidence } = snapshot
    const current = reviews.current(publication.lessonRevisionId)
    const lesson = this.context.sqlite
      .prepare("SELECT record_json FROM lesson_revisions WHERE id = ?")
      .get(publication.lessonRevisionId)
    const outline = lesson
      ? z
          .object({ outlineRevisionId: z.string() })
          .parse(JSON.parse(rowSchema.parse(lesson).record_json)).outlineRevisionId
      : null
    return (
      current?.id === evidence.draft.id &&
      JSON.stringify(current) === JSON.stringify(evidence.draft) &&
      reviews.latestLessonId(evidence.draft.studyId) === publication.lessonRevisionId &&
      publication.approval.rendererVersion === PUBLICATION_RENDERER &&
      outline !== null &&
      this.outlines.approved(outline) !== null
    )
  }

  approve(input: unknown): PublicationSnapshot {
    const snapshot = PublicationSnapshot.parse(input)
    return this.context.sqlite
      .transaction(() => {
        if (!this.current(snapshot)) throw new ContractBoundaryError("stale publication approval")
        if (!this.publications.getPrivacyReview(snapshot.publication.privacyReview.id))
          this.publications.appendPrivacyReview({
            record: snapshot.publication.privacyReview,
            parentRevisionId: null,
          })
        const parent = this.list(snapshot.evidence.draft.studyId)[0]
        this.publications.appendPublication({
          record: snapshot.publication,
          parentRevisionId: parent?.publication.id ?? null,
        })
        this.context.sqlite
          .prepare("INSERT INTO publication_snapshots VALUES (?, ?, ?, ?)")
          .run(
            snapshot.publication.id,
            snapshot.evidence.draft.studyId,
            snapshot.evidence.draft.id,
            JSON.stringify(snapshot),
          )
        for (const format of ["html", "pdf"] as const) {
          const output = PublicationOutput.parse({
            id: randomUUID(),
            publicationId: snapshot.publication.id,
            format,
            state: "queued",
            expiresAt: null,
            error: null,
            artifact: null,
          })
          this.context.sqlite
            .prepare(
              "INSERT INTO publication_outputs (id, publication_id, format, state, record_json) VALUES (?, ?, ?, ?, ?)",
            )
            .run(output.id, output.publicationId, format, output.state, JSON.stringify(output))
        }
        return snapshot
      })
      .immediate()
  }

  outputs(input: unknown): readonly PublicationOutput[] {
    return this.context.sqlite
      .prepare(
        "SELECT record_json FROM publication_outputs WHERE publication_id = ? ORDER BY rowid",
      )
      .all(PublicationRevisionId.parse(input))
      .map((row) =>
        this.expire(PublicationOutput.parse(JSON.parse(rowSchema.parse(row).record_json))),
      )
  }

  nextQueued(): PublicationOutput | null {
    const rows = this.context.sqlite
      .prepare("SELECT record_json FROM publication_outputs WHERE state = 'queued' ORDER BY rowid")
      .all()
    for (const row of rows) {
      const output = PublicationOutput.parse(JSON.parse(rowSchema.parse(row).record_json))
      const snapshot = this.get(output.publicationId)
      if (snapshot && this.current(snapshot)) return output
    }
    return null
  }

  output(input: unknown): PublicationOutput | null {
    const row = this.context.sqlite
      .prepare("SELECT record_json FROM publication_outputs WHERE id = ?")
      .get(JobId.parse(input))
    return row
      ? this.expire(PublicationOutput.parse(JSON.parse(rowSchema.parse(row).record_json)))
      : null
  }

  claim(input: unknown): PublicationOutput {
    return this.context.sqlite
      .transaction(() => {
        const output = this.output(input)
        const snapshot = output ? this.get(output.publicationId) : null
        if (output?.state !== "queued" || !snapshot || !this.current(snapshot))
          throw new ContractBoundaryError("current publication required before rendering")
        const running = PublicationOutput.parse({
          ...output,
          state: "running",
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        })
        this.write(running, null)
        return running
      })
      .immediate()
  }

  release(input: unknown, bytes: Uint8Array): Artifact {
    const artifact = Artifact.parse(input)
    return this.context.sqlite
      .transaction(() => {
        const output = this.output(artifact.provenance.jobId)
        const snapshot = this.get(artifact.publicationRevisionId)
        if (
          output?.state !== "running" ||
          !snapshot ||
          !this.current(snapshot) ||
          output.publicationId !== artifact.publicationRevisionId ||
          output.format !== artifact.format ||
          createHash("sha256").update(bytes).digest("hex") !== artifact.contentHash
        )
          throw new ContractBoundaryError("current publication required before release")
        ApprovedArtifact.parse({ publication: snapshot.publication, artifact })
        this.write(PublicationOutput.parse({ ...output, state: "released", artifact }), bytes)
        return artifact
      })
      .immediate()
  }

  fail(input: unknown, code: string): void {
    this.context.sqlite
      .transaction(() => {
        const output = this.output(input)
        if (!output) throw new ContractBoundaryError("output required")
        if (output.state === "queued" || output.state === "running")
          this.write(PublicationOutput.parse({ ...output, state: "failed", error: code }), null)
      })
      .immediate()
  }

  download(input: unknown): Uint8Array | null {
    const output = this.output(input)
    if (output?.state !== "released" || !output.artifact) return null
    const snapshot = this.get(output.publicationId)
    if (!snapshot) return null
    ApprovedArtifact.parse({ publication: snapshot.publication, artifact: output.artifact })
    const row = this.context.sqlite
      .prepare("SELECT bytes FROM publication_outputs WHERE id = ?")
      .get(output.id)
    const bytes = z.object({ bytes: z.instanceof(Uint8Array) }).parse(row).bytes
    if (createHash("sha256").update(bytes).digest("hex") !== output.artifact.contentHash)
      throw new ContractBoundaryError("artifact integrity")
    return bytes
  }

  private write(output: PublicationOutput, bytes: Uint8Array | null): void {
    this.context.sqlite
      .prepare("UPDATE publication_outputs SET state = ?, record_json = ?, bytes = ? WHERE id = ?")
      .run(output.state, JSON.stringify(output), bytes, output.id)
  }

  private expire(output: PublicationOutput): PublicationOutput {
    if (
      output.state !== "running" ||
      !output.expiresAt ||
      Date.parse(output.expiresAt) > Date.now()
    )
      return output
    const failed = PublicationOutput.parse({
      ...output,
      state: "failed",
      error: "interrupted-or-timeout",
    })
    this.context.sqlite
      .prepare(
        "UPDATE publication_outputs SET state = 'failed', record_json = ? WHERE id = ? AND state = 'running'",
      )
      .run(JSON.stringify(failed), output.id)
    return failed
  }
}
