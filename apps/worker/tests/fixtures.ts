import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AnalysisCacheInput, analysisCacheKey, Digest, Job } from "@reading-studio/contracts"
import { openStorage, type Storage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"

export const HASH_A = Digest.parse("a".repeat(64))
export const HASH_B = Digest.parse("b".repeat(64))
export const HASH_C = Digest.parse("c".repeat(64))

export type JobStorageFixture = {
  readonly directory: string
  readonly databasePath: string
  readonly privateDataRoot: string
  readonly storage: Storage
  readonly job: Job
  readonly artifact: ReturnType<typeof completeGraphFixtures>["artifact"]
}

export function seedQueuedJob(input?: {
  readonly maxCalls?: number
  readonly stage?: Job["stage"]
  readonly model?: string
  readonly provider?: "openai" | "anthropic" | "openrouter"
  readonly maxSchemaRepairs?: number
  readonly maxTransientRetries?: number
}): JobStorageFixture {
  const directory = mkdtempSync(join(tmpdir(), "reading-studio-jobs-"))
  const databasePath = join(directory, "studio.sqlite")
  const privateDataRoot = join(directory, "private-data")
  const storage = openStorage({ databasePath, privateDataRoot })
  const fixture = completeGraphFixtures()
  const analysis = {
    ...fixture.analysis,
    cacheKey: analysisCacheKey(AnalysisCacheInput.parse(fixture.analysis.cacheInput)),
  }
  storage.sources.createOwner("owner-1")
  storage.sources.createInstallation({ id: "installation-1", ownerId: "owner-1" })
  storage.sources.appendEdition(fixture.edition)
  storage.sources.createStudy({ id: "study-1", ownerId: "owner-1", editionId: "edition-1" })
  storage.sources.appendNormalization({ record: fixture.normalization, parentRevisionId: null })
  storage.sources.appendSetup({
    record: {
      ...fixture.setup,
      analysis: {
        ...fixture.setup.analysis,
        provider: input?.provider ?? fixture.setup.analysis.provider,
        model: input?.model ?? fixture.setup.analysis.model,
      },
    },
    parentRevisionId: null,
  })
  storage.sources.appendGrant(fixture.grant)
  storage.workflow.appendAnalysis({ record: analysis, parentRevisionId: null })
  storage.workflow.appendQuestion({ record: fixture.question, parentRevisionId: null })
  storage.workflow.appendAnswer({
    id: "input-1",
    studyId: "study-1",
    parentRevisionId: null,
    submission: fixture.submission,
  })
  storage.workflow.appendBrief({ record: fixture.brief, parentRevisionId: null })
  storage.workflow.appendOutline({ record: fixture.outline, parentRevisionId: null })
  storage.workflow.appendLesson({ record: fixture.lesson, parentRevisionId: null })
  storage.workflow.appendEvidenceReport(fixture.evidenceReport)
  storage.workflow.appendPrivacyReview({ record: fixture.privacyReview, parentRevisionId: null })
  storage.workflow.appendPublication({ record: fixture.publication, parentRevisionId: null })
  const run = {
    ...fixture.run,
    budget: {
      ...fixture.run.budget,
      maxCalls: input?.maxCalls ?? 2,
      maxSchemaRepairs: input?.maxSchemaRepairs ?? 0,
      maxTransientRetries: input?.maxTransientRetries ?? 0,
    },
    reservedCalls: 0,
    state: "running" as const,
  }
  const job = Job.parse({
    ...fixture.job,
    model: input?.model ?? fixture.job.model,
    provider: input?.provider ?? fixture.job.provider,
    stage: input?.stage ?? "analysis",
    state: "queued" as const,
  })
  storage.execution.appendRun(run)
  storage.execution.appendJob(job)
  return { directory, databasePath, privateDataRoot, storage, job, artifact: fixture.artifact }
}

export function seedActiveJob(input?: Parameters<typeof seedQueuedJob>[0]): JobStorageFixture {
  return seedQueuedJob({ provider: "openrouter", model: "gpt-4.1-mini", ...input })
}

export function lease(
  jobId: string,
  token: string,
  fence: number,
  now: string,
): {
  readonly jobId: string
  readonly token: string
  readonly fence: number
  readonly now: string
} {
  return { jobId, token, fence, now }
}
