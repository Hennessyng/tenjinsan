import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import {
  contentDigest,
  FullBookConsentError,
  FullBookManagedPolicy,
} from "@reading-studio/contracts"
import { fullBookNativeReleased } from "@reading-studio/storage"
import type { FullBookPreparationOptions } from "./full-book-preparation.ts"

export type FullBookServerRuntime = Readonly<{
  resolve: (options: FullBookPreparationOptions) => FullBookManagedPolicy | null
  execute?: (id: string, signal: AbortSignal) => Promise<unknown>
}>
export function inspectFullBookRuntime(
  source: FullBookServerRuntime | undefined,
  options: FullBookPreparationOptions,
) {
  const raw = source?.resolve(options)
  if (!raw) return null
  const parsed = FullBookManagedPolicy.safeParse(raw)
  if (!parsed.success) throw new FullBookConsentError("authority")
  const policy = parsed.data
  if (options.policy.maxAppBytes > 32000 || options.policy.maxOutputBytes > 16000)
    throw new FullBookConsentError("authority")
  if (
    policy.maxFrameBytes !== options.policy.maxAppBytes ||
    policy.collectorBytes !== options.collectorBytes ||
    policy.timeoutMs !== options.timeoutMs
  )
    throw new FullBookConsentError("authority")
  let path: string
  try {
    path = realpathSync(policy.build.binaryPath)
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== policy.build.sha256)
      throw new FullBookConsentError("authority")
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "EACCES", "EPERM", "ELOOP", "EISDIR"].includes(String(error.code))
    )
      throw new FullBookConsentError("authority")
    throw error
  }
  const normalized = FullBookManagedPolicy.parse({
    ...policy,
    build: { ...policy.build, binaryPath: path },
  })
  const binding = contentDigest(JSON.stringify(normalized))
  return {
    policy: normalized,
    binding,
    public: {
      kind: policy.build.kind,
      sha256: policy.build.sha256,
      version: policy.build.kind === "pinned-codex" ? policy.build.version : "fixture-1",
      binding,
    },
    released: fullBookNativeReleased(policy.build),
  }
}
