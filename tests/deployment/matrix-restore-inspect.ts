import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { EvidenceDraft, Job } from "@reading-studio/contracts"
import { openMaintenanceDatabase, openStorage } from "@reading-studio/storage"
import { z } from "zod"
import { TABLES } from "../../packages/storage/src/backup-tables.ts"

export const RestoreInspection = z.object({
  owner: z.object({ id: z.string(), email: z.string(), credentialHash: z.string() }),
  counts: z.object({
    editions: z.number(),
    studies: z.number(),
    grants: z.number(),
    jobs: z.number(),
    runs: z.number(),
    approvals: z.number(),
    privacyReviews: z.number(),
    publications: z.number(),
    artifacts: z.number(),
  }),
  domainRows: z.record(z.string(), z.number().int().nonnegative()),
  studies: z.array(z.object({ id: z.string(), ownerId: z.string() })),
  grants: z.array(
    z.object({ id: z.string(), kind: z.string(), ownerId: z.string(), installationId: z.string() }),
  ),
  installations: z.array(z.object({ id: z.string(), ownerId: z.string() })),
  jobs: z.array(
    z.object({ id: z.string(), state: z.string(), grantKind: z.string(), ownerId: z.string() }),
  ),
  runs: z.array(z.object({ id: z.string(), state: z.string() })),
  evidenceDrafts: z.array(
    z.object({ id: z.string(), privacyReviewed: z.boolean(), keepPrivate: z.boolean() }),
  ),
  blobs: z.array(z.string()),
  activeOutputs: z.number(),
  historicalRecords: z.number(),
  maintenanceBlockers: z.object({
    requests: z.number(),
    runningJobs: z.number(),
    runningOutputs: z.number(),
    uncertainAttempts: z.number(),
  }),
})

export function readRestoreInspection(databasePath: string, privateDataRoot: string) {
  const storage = openStorage({ databasePath, privateDataRoot })
  const sqlite = openMaintenanceDatabase(databasePath)
  try {
    const owners = z
      .array(z.object({ id: z.string(), email: z.string() }))
      .parse(sqlite.prepare("SELECT id, email FROM auth_users").all())
    const account = z
      .object({ password: z.string() })
      .parse(sqlite.prepare("SELECT password FROM auth_accounts LIMIT 1").get())
    const owner = owners[0]
    if (owners.length !== 1 || !owner) throw new TypeError("One provisioned owner required")
    const blobRoot = join(privateDataRoot, "blobs")
    const blobs = existsSync(blobRoot)
      ? readdirSync(blobRoot, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => {
            const path = storage.blobs.pathFor(entry.name)
            const hash = createHash("sha256").update(readFileSync(path)).digest("hex")
            if (hash !== entry.name) throw new TypeError("Private blob hash mismatch")
            return hash
          })
          .sort()
      : []
    const data = {
      owner: {
        ...owner,
        credentialHash: createHash("sha256").update(account.password).digest("hex"),
      },
      counts: storage.counts(),
      domainRows: Object.fromEntries(
        TABLES.filter((table) => !table.historical).map((table) => [
          table.name,
          z
            .object({ total: z.number() })
            .parse(sqlite.prepare(`SELECT COUNT(*) AS total FROM ${table.name}`).get()).total,
        ]),
      ),
      studies: z
        .array(z.object({ id: z.string(), ownerId: z.string() }))
        .parse(sqlite.prepare("SELECT id, owner_id AS ownerId FROM studies ORDER BY id").all()),
      grants: z
        .array(
          z.object({
            id: z.string(),
            kind: z.string(),
            ownerId: z.string(),
            installationId: z.string(),
          }),
        )
        .parse(
          sqlite
            .prepare(
              "SELECT id, kind, owner_id AS ownerId, installation_id AS installationId FROM transmission_grants ORDER BY id",
            )
            .all(),
        ),
      installations: z
        .array(z.object({ id: z.string(), ownerId: z.string() }))
        .parse(
          sqlite.prepare("SELECT id, owner_id AS ownerId FROM installations ORDER BY id").all(),
        ),
      jobs: z
        .array(z.object({ id: z.string(), record_json: z.string() }))
        .parse(sqlite.prepare("SELECT id, record_json FROM jobs ORDER BY id").all())
        .map(({ id, record_json }) => {
          const job = Job.parse(JSON.parse(record_json))
          return { id, state: job.state, grantKind: job.grant.kind, ownerId: job.grant.ownerId }
        }),
      runs: z
        .array(z.object({ id: z.string(), state: z.string() }))
        .parse(sqlite.prepare("SELECT id, state FROM generation_runs ORDER BY id").all()),
      evidenceDrafts: z
        .array(z.object({ record_json: z.string() }))
        .parse(sqlite.prepare("SELECT record_json FROM evidence_review_drafts ORDER BY id").all())
        .map(({ record_json }) => {
          const draft = EvidenceDraft.parse(JSON.parse(record_json))
          return {
            id: draft.id,
            privacyReviewed: draft.privacyReviewed,
            keepPrivate: draft.keepPrivate,
          }
        }),
      blobs,
      activeOutputs: z
        .object({ total: z.number() })
        .parse(sqlite.prepare("SELECT COUNT(*) AS total FROM publication_outputs").get()).total,
      historicalRecords: z
        .object({ total: z.number() })
        .parse(sqlite.prepare("SELECT COUNT(*) AS total FROM backup_history").get()).total,
      maintenanceBlockers: {
        requests: z
          .object({ total: z.number() })
          .parse(sqlite.prepare("SELECT COUNT(*) AS total FROM maintenance_requests").get()).total,
        runningJobs: z
          .object({ total: z.number() })
          .parse(sqlite.prepare("SELECT COUNT(*) AS total FROM jobs WHERE state = 'running'").get())
          .total,
        runningOutputs: z
          .object({ total: z.number() })
          .parse(
            sqlite
              .prepare("SELECT COUNT(*) AS total FROM publication_outputs WHERE state = 'running'")
              .get(),
          ).total,
        uncertainAttempts: z
          .object({ total: z.number() })
          .parse(
            sqlite
              .prepare(
                "SELECT COUNT(*) AS total FROM external_attempts WHERE state = 'dispatching' OR (state = 'outcome_unknown' AND json_extract(record_json, '$.resolution') = 'awaiting-owner')",
              )
              .get(),
          ).total,
      },
    }
    return RestoreInspection.parse(data)
  } finally {
    sqlite.close()
    storage.close()
  }
}

const executablePath = process.argv[1]
if (executablePath && import.meta.url === pathToFileURL(executablePath).href) {
  const paths = z
    .object({ DATABASE_PATH: z.string(), PRIVATE_DATA_ROOT: z.string() })
    .parse(process.env)
  process.stdout.write(
    `${JSON.stringify(readRestoreInspection(paths.DATABASE_PATH, paths.PRIVATE_DATA_ROOT))}\n`,
  )
}
