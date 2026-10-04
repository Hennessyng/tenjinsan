import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { WorkflowLineage } from "@reading-studio/contracts"
import { openStorage, type Storage } from "@reading-studio/storage"
import { z } from "zod"

const StoredOutput = z.strictObject({
  jobId: z.string(),
  format: z.enum(["html", "pdf"]),
  state: z.literal("released"),
  publicationId: z.string(),
  artifactPublicationId: z.string(),
  artifactSha256: z.string(),
  storedSha256: z.string(),
  storedBytes: z.number().int().positive(),
})
const StoredStudy = z.strictObject({
  studyId: z.string(),
  ownerId: z.string(),
  editionId: z.string(),
  setupId: z.string(),
  parent: z.strictObject({ studyId: z.string(), setupRevisionId: z.string() }).nullable(),
  analysisId: z.string(),
  grantId: z.string().nullable(),
  briefId: z.string(),
  outlineId: z.string(),
  lessonId: z.string(),
  currentPublication: z.boolean(),
  publication: z.strictObject({
    id: z.string(),
    lessonId: z.string(),
    evidenceId: z.string(),
    evidenceReportHash: z.string(),
    reviewedReportHash: z.string(),
    privacyReviewId: z.string(),
  }),
  outputs: z.array(StoredOutput).length(2),
})
export const Task31Records = z.strictObject({ original: StoredStudy, fork: StoredStudy })

function storedStudy(storage: Storage, studyId: string) {
  const setup = storage.sources.getLatestSetup(studyId)
  if (!setup) throw new TypeError("Missing deployed setup")
  const owner = storage.sources
    .listStudiesByEdition(setup.editionId)
    .find((study) => study.id === studyId)?.ownerId
  if (!owner) throw new TypeError("Missing owner relationship")
  const revision = storage.revisions.current({ studyId, ownerId: owner })
  const brief = revision.brief && storage.briefs.approved(revision.brief.draft.id)
  const currentOutline = storage.outlines.current(studyId)
  const outline = currentOutline && storage.outlines.approved(currentOutline.draft.id)
  const snapshot = storage.publicationOutputs.list(studyId)[0]
  const lesson = snapshot && storage.workflow.getLesson(snapshot.publication.lessonRevisionId)
  if (!brief || !outline || !lesson || !snapshot || !revision.analysis)
    throw new TypeError("Incomplete deployed publication lineage")
  WorkflowLineage.parse({ brief, outline, lesson })
  const outputs = storage.publicationOutputs.outputs(snapshot.publication.id).map((output) => {
    if (output.state !== "released") throw new TypeError("Publication output not released")
    const bytes = storage.publicationOutputs.download(output.id)
    if (!bytes) throw new TypeError("Released artifact is unreadable")
    return {
      jobId: output.id,
      format: output.format,
      state: output.state,
      publicationId: output.publicationId,
      artifactPublicationId: output.artifact.publicationRevisionId,
      artifactSha256: output.artifact.contentHash,
      storedSha256: createHash("sha256").update(bytes).digest("hex"),
      storedBytes: bytes.byteLength,
    }
  })
  return {
    studyId,
    ownerId: owner,
    editionId: setup.editionId,
    setupId: setup.id,
    parent: revision.parent,
    analysisId: revision.analysis.id,
    grantId: revision.grant?.id ?? null,
    briefId: brief.id,
    outlineId: outline.id,
    lessonId: lesson.id,
    currentPublication: storage.publicationOutputs.current(snapshot),
    publication: {
      id: snapshot.publication.id,
      lessonId: snapshot.publication.lessonRevisionId,
      evidenceId: snapshot.evidence.draft.id,
      evidenceReportHash: snapshot.publication.approval.evidenceReportHash,
      reviewedReportHash: snapshot.evidence.reportHash,
      privacyReviewId: snapshot.publication.privacyReview.id,
    },
    outputs,
  }
}

export function readTask31Records(storage: Storage, studyId: string, forkId: string) {
  return Task31Records.parse({
    original: storedStudy(storage, studyId),
    fork: storedStudy(storage, forkId),
  })
}

const executablePath = process.argv[1]
if (executablePath && import.meta.url === pathToFileURL(executablePath).href) {
  const config = z
    .object({ DATABASE_PATH: z.string().min(1), PRIVATE_DATA_ROOT: z.string().min(1) })
    .parse(process.env)
  const [studyId, forkId] = z
    .tuple([z.string().min(1), z.string().min(1)])
    .parse(process.argv.slice(2))
  const storage = openStorage({
    databasePath: config.DATABASE_PATH,
    privateDataRoot: config.PRIVATE_DATA_ROOT,
  })
  try {
    process.stdout.write(`${JSON.stringify(readTask31Records(storage, studyId, forkId))}\n`)
  } finally {
    storage.close()
  }
}
