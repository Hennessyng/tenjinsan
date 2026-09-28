import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { contentDigest } from "@reading-studio/contracts"
import { LeaseFenceError, openStorage } from "@reading-studio/storage"
import { z } from "zod"

const leasePath = "/data/matrix-stale-lease"

type LibraryPaths = { readonly databasePath: string; readonly privateDataRoot: string }

export function captureLease(paths: LibraryPaths, jobId: string): void {
  const storage = openStorage(paths)
  try {
    const job = storage.execution.getJob(jobId)
    if (job?.state !== "running") throw new TypeError("Missing running worker lease")
    writeFileSync(leasePath, JSON.stringify({ jobId, lease: job.lease }), { mode: 0o600 })
  } finally {
    storage.close()
  }
}

export function rejectStaleCommit(
  paths: LibraryPaths,
  jobId: string,
  lease: { readonly token: string; readonly fence: number },
): boolean {
  const storage = openStorage(paths)
  try {
    try {
      storage.execution.completeJob({
        jobId,
        token: lease.token,
        fence: lease.fence,
        now: new Date().toISOString(),
        resultHash: contentDigest("stale-worker-must-not-commit"),
      })
      return false
    } catch (error) {
      if (error instanceof LeaseFenceError) return true
      throw error
    }
  } finally {
    storage.close()
  }
}

const executablePath = process.argv[1]
if (executablePath && import.meta.url === pathToFileURL(executablePath).href) {
  const env = z
    .object({ DATABASE_PATH: z.string(), PRIVATE_DATA_ROOT: z.string() })
    .parse(process.env)
  const paths = { databasePath: env.DATABASE_PATH, privateDataRoot: env.PRIVATE_DATA_ROOT }
  const input = z.tuple([z.enum(["capture", "probe"]), z.string()]).parse(process.argv.slice(2))
  if (input[0] === "capture") captureLease(paths, input[1])
  else {
    const captured = z
      .object({ jobId: z.string(), lease: z.object({ token: z.string(), fence: z.number() }) })
      .parse(JSON.parse(readFileSync(leasePath, "utf8")))
    if (captured.jobId !== input[1]) throw new TypeError("Stale lease job changed")
    process.stdout.write(
      `${JSON.stringify({
        rejected: rejectStaleCommit(paths, captured.jobId, captured.lease),
      })}\n`,
    )
  }
}
