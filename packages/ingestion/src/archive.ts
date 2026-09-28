import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises"
import { basename, isAbsolute, join } from "node:path"
import { z } from "zod"
import {
  ArchiveError,
  type ArchiveLimits,
  archiveLimitsSchema,
  DEFAULT_ARCHIVE_LIMITS,
} from "./archive-policy.ts"
import { inspectZip } from "./zip-inspection.ts"

export { ArchiveError, type ArchiveLimits, DEFAULT_ARCHIVE_LIMITS } from "./archive-policy.ts"

export type UploadOptions = {
  readonly root: string
  readonly ownerId: string
  readonly limits?: ArchiveLimits
}

export async function acceptUpload(body: ReadableStream<Uint8Array>, options: UploadOptions) {
  const limits = archiveLimitsSchema.parse(options.limits ?? DEFAULT_ARCHIVE_LIMITS)
  const ownerId = z.string().min(1).parse(options.ownerId)
  if (!isAbsolute(options.root)) throw new ArchiveError("unsafe-root")
  await mkdir(options.root, { recursive: true, mode: 0o700 })
  const root = await lstat(options.root)
  if (!root.isDirectory() || root.isSymbolicLink()) throw new ArchiveError("unsafe-root")
  const directory = await mkdtemp(join(options.root, "import-"))
  let accepted = false
  try {
    await using original = await open(join(directory, "original.epub"), "wx+", 0o600)
    const hash = createHash("sha256")
    const reader = body.getReader()
    let bytes = 0
    let finished = false
    try {
      while (true) {
        const result = await reader.read()
        if (result.done) {
          finished = true
          break
        }
        bytes += result.value.byteLength
        if (bytes > limits.compressedBytes) throw new ArchiveError("limit-exceeded")
        hash.update(result.value)
        await original.writeFile(result.value)
      }
    } finally {
      try {
        if (!finished) await reader.cancel()
      } finally {
        reader.releaseLock()
      }
    }
    await original.sync()
    const inspected = await inspectZip(original, { bytes, limits })
    const receipt = {
      id: basename(directory),
      state: "queued" as const,
      sha256: hash.digest("hex"),
      bytes,
      ...inspected,
    }
    await using queued = await open(join(directory, ".queued.json"), "wx", 0o600)
    await writeFile(queued, JSON.stringify({ ...receipt, ownerId }))
    await queued.sync()
    await rename(join(directory, ".queued.json"), join(directory, "queued.json"))
    await using parent = await open(directory, "r")
    await parent.sync()
    await using intakeRoot = await open(options.root, "r")
    await intakeRoot.sync()
    accepted = true
    return receipt
  } finally {
    if (!accepted) await rm(directory, { recursive: true, force: true })
  }
}
