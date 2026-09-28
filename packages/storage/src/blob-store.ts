import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { Digest } from "@reading-studio/contracts"
import { PrivatePathError } from "./errors.ts"

function requireDirectoryWithoutSymlink(path: string, label: string): void {
  const status = lstatSync(path)
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new PrivatePathError(`${label} must be a real directory`)
  }
}

export class PrivateBlobStore {
  readonly #root: string
  readonly #blobsRoot: string

  constructor(privateDataRoot: unknown) {
    if (typeof privateDataRoot !== "string" || !isAbsolute(privateDataRoot)) {
      throw new PrivatePathError("data root must be absolute")
    }
    mkdirSync(privateDataRoot, { recursive: true, mode: 0o700 })
    requireDirectoryWithoutSymlink(privateDataRoot, "data root")
    this.#root = realpathSync(privateDataRoot)
    this.#blobsRoot = join(this.#root, "blobs")
    if (existsSync(this.#blobsRoot)) {
      requireDirectoryWithoutSymlink(this.#blobsRoot, "blob root")
    } else {
      mkdirSync(this.#blobsRoot, { mode: 0o700 })
    }
  }

  pathFor(input: unknown): string {
    const parsed = Digest.safeParse(input)
    if (!parsed.success) throw new PrivatePathError("content hash must be SHA-256")
    const hash = parsed.data
    const shard = join(this.#blobsRoot, hash.slice(0, 2))
    if (existsSync(shard)) requireDirectoryWithoutSymlink(shard, "blob shard")
    const candidate = resolve(shard, hash)
    const relativePath = relative(this.#root, candidate)
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new PrivatePathError("resolved path escapes data root")
    }
    const candidateStatus = lstatSync(candidate, { throwIfNoEntry: false })
    if (candidateStatus?.isSymbolicLink()) {
      throw new PrivatePathError("blob entry must not be a symbolic link")
    }
    if (candidateStatus !== undefined) {
      const resolvedCandidate = realpathSync(candidate)
      const resolvedRelativePath = relative(this.#root, resolvedCandidate)
      if (resolvedRelativePath.startsWith("..") || isAbsolute(resolvedRelativePath)) {
        throw new PrivatePathError("existing blob resolves outside data root")
      }
    }
    return candidate
  }
}
