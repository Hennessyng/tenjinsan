import { spawnSync } from "node:child_process"
import { expect } from "@playwright/test"
import { z } from "zod"
import { workspaceRoot } from "./local-fixture.ts"
import type { MatrixDeployment } from "./matrix-driver.ts"
import { recordCase } from "./matrix-evidence.ts"
import type { RestoreInspection } from "./matrix-restore-inspect.ts"

const ArchiveInspection = z.strictObject({
  encryptedHash: z.string().length(64),
  manifestHash: z.string().length(64),
  referencedBlobCount: z.number().int().positive(),
  historicalRecords: z.number().int().positive(),
})
const ArchiveReceipt = z.strictObject({
  referencedBlobCount: z.number().int().positive(),
  historicalRecords: z.number().int().positive(),
  archiveValidated: z.literal(true),
})

export type RestoreTargets = {
  readonly studyId: string
  readonly publicationId: string
  readonly outputId: string
  readonly sourceSessionCookie: string
}

export type RestoreReceipt = {
  readonly archive: z.infer<typeof ArchiveReceipt>
  readonly destinationOwnerId: string
  readonly restoredStudies: number
  readonly pausedJobs: number
  readonly historicalGrants: number
  readonly verifiedBlobCount: number
  readonly allBlobsMatched: true
  readonly destinationCredentialPreserved: true
  readonly publicStudyHttp: number
  readonly historicalGenerationHttp: number
  readonly historicalDownloadHttp: number
  readonly activeSessionHttp: number
  readonly freshLoginHttp: number
  readonly separateStorage: boolean
  readonly wrongPassphraseRejected: boolean
  readonly corruptCiphertextRejected: boolean
}

export const RestoreReceiptSchema: z.ZodType<RestoreReceipt> = z.strictObject({
  archive: ArchiveReceipt,
  destinationOwnerId: z.string().min(1),
  restoredStudies: z.number().int().positive(),
  pausedJobs: z.number().int().positive(),
  historicalGrants: z.number().int().positive(),
  verifiedBlobCount: z.number().int().positive(),
  allBlobsMatched: z.literal(true),
  destinationCredentialPreserved: z.literal(true),
  publicStudyHttp: z.number().int(),
  historicalGenerationHttp: z.number().int(),
  historicalDownloadHttp: z.number().int(),
  activeSessionHttp: z.number().int(),
  freshLoginHttp: z.number().int(),
  separateStorage: z.boolean(),
  sessionCookiesDistinct: z.boolean(),
  wrongPassphraseRejected: z.boolean(),
  corruptCiphertextRejected: z.boolean(),
})

export function runAgeTransfer(args: readonly string[], environment: NodeJS.ProcessEnv) {
  const result = spawnSync("expect", ["tests/deployment/matrix-age-transfer.exp", ...args], {
    cwd: workspaceRoot,
    env: environment,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0)
    throw new TypeError(`TTY age transfer failed (${result.status ?? result.signal})`)
  expect(result.stdout).toContain(
    "wrong-passphrase: rejected; corrupt-ciphertext: rejected; destination-auth-and-domain: unchanged; destination-restore: succeeded",
  )
  const inspected = /ARCHIVE_CHECK (\{[^\r\n]+\})/.exec(result.stdout)?.[1]
  if (!inspected) throw new TypeError("Encrypted archive inspection missing")
  const verified = ArchiveInspection.parse(JSON.parse(inspected))
  return ArchiveReceipt.parse({
    referencedBlobCount: verified.referencedBlobCount,
    historicalRecords: verified.historicalRecords,
    archiveValidated: true,
  })
}

export function assertRestoredLibrary(input: {
  readonly source: z.infer<typeof RestoreInspection>
  readonly before: z.infer<typeof RestoreInspection>
  readonly restored: z.infer<typeof RestoreInspection>
  readonly archive: z.infer<typeof ArchiveReceipt>
}): void {
  const { source, before, restored, archive } = input
  expect(source.counts.studies).toBeGreaterThan(0)
  expect(source.counts.jobs).toBeGreaterThan(0)
  expect(source.counts.publications).toBeGreaterThan(0)
  expect(source.blobs.length).toBeGreaterThan(0)
  expect(before.counts.studies).toBe(0)
  expect(before.counts.jobs).toBe(0)
  expect(before.owner.email).toBe("destination-owner@example.test")
  expect(restored.owner.id).toBe(before.owner.id)
  expect(restored.owner.email).toBe(before.owner.email)
  expect(restored.owner.credentialHash === before.owner.credentialHash).toBe(true)
  expect(restored.owner.id).not.toBe(source.owner.id)
  expect(restored.counts.editions).toBe(source.counts.editions)
  expect(restored.counts.studies).toBe(source.counts.studies)
  expect(restored.counts.grants).toBe(source.counts.grants)
  expect(restored.counts.jobs).toBe(source.counts.jobs)
  expect(restored.counts.runs).toBe(source.counts.runs)
  expect(restored.studies.map((study) => study.id)).toEqual(source.studies.map((study) => study.id))
  expect(restored.studies.every((study) => study.ownerId === before.owner.id)).toBe(true)
  expect(restored.grants.map((grant) => grant.id)).toEqual(source.grants.map((grant) => grant.id))
  expect(restored.grants.every((grant) => grant.kind === "historical")).toBe(true)
  expect(restored.grants.every((grant) => grant.ownerId === before.owner.id)).toBe(true)
  expect(restored.grants.every((grant) => grant.installationId !== "historical-installation")).toBe(
    true,
  )
  expect(restored.installations).toEqual([
    { id: restored.grants[0]?.installationId, ownerId: before.owner.id },
  ])
  expect(restored.jobs.map((job) => job.id)).toEqual(source.jobs.map((job) => job.id))
  expect(
    restored.jobs.every(
      (job) =>
        job.state === "paused" && job.grantKind === "historical" && job.ownerId === before.owner.id,
    ),
  ).toBe(true)
  expect(restored.runs.every((run) => run.state === "paused")).toBe(true)
  expect(restored.counts.approvals).toBe(0)
  expect(restored.counts.privacyReviews).toBe(0)
  expect(restored.counts.publications).toBe(0)
  expect(restored.counts.artifacts).toBe(0)
  expect(restored.activeOutputs).toBe(0)
  expect(restored.evidenceDrafts.length).toBe(source.evidenceDrafts.length)
  expect(
    restored.evidenceDrafts.every((draft) => !draft.privacyReviewed && draft.keepPrivate),
  ).toBe(true)
  expect(source.blobs.every((hash) => restored.blobs.includes(hash))).toBe(true)
  expect(restored.blobs.length).toBe(archive.referencedBlobCount)
  expect(restored.historicalRecords).toBe(archive.historicalRecords)
}

export async function runRestoreCase(
  deployment: MatrixDeployment,
  targets: Omit<RestoreTargets, "sourceSessionCookie">,
) {
  const before = await deployment.snapshot()
  const providerCalls = await deployment.wireCount()
  const sourceSessionCookie = (await deployment.page.context().cookies(deployment.origin)).find(
    (cookie) => cookie.name.endsWith("better-auth.session_token"),
  )?.value
  if (!sourceSessionCookie) throw new TypeError("Source owner session cookie missing")
  const restore = RestoreReceiptSchema.parse(
    await deployment.transfer({ ...targets, sourceSessionCookie }),
  )
  expect(
    (
      await deployment.page.request.get(`${deployment.origin}/api/publications/${targets.studyId}`)
    ).status(),
  ).toBe(200)
  expect(await deployment.snapshot()).toEqual(before)
  expect(await deployment.wireCount()).toBe(providerCalls)
  return recordCase(deployment, {
    name: "destination-owner-restore",
    http: restore.publicStudyHttp,
    job: "paused",
    restore,
  })
}
