import type {
  BatchedVerificationTarget,
  CoverageVerificationTarget,
  Digest,
  Job,
} from "@reading-studio/contracts"
import type { z } from "zod"
import type { ProviderAdapter } from "./adapter.ts"
import type { ProviderAuthority } from "./authorization.ts"
import type { ProviderName } from "./catalog.ts"
import type { VerifiedRouteCapacity } from "./request-capacity.ts"

export const providerJobIdentityFields = [
  "runId",
  "inputRevisionId",
  "setupRevisionId",
  "provider",
  "model",
  "promptVersion",
  "schemaVersion",
  "stage",
] as const

export type RunningProviderJob = Extract<Job, { readonly state: "running" }>
export type ProviderRunnerOptions = ProviderAuthority & {
  readonly clock: () => Date
  readonly adapters: Readonly<
    Partial<
      Record<
        ProviderName,
        Pick<ProviderAdapter, "dispatch"> & Partial<Pick<ProviderAdapter, "measure">>
      >
    >
  >
}
export type StructuredStage = {
  readonly schema: z.ZodType
  readonly wireSchema?: Record<string, unknown>
  readonly instruction: string
  readonly signal?: AbortSignal
  readonly sourceWindow?: { readonly blockId: string; readonly start: number; readonly end: number }
  readonly sourceRanges?: readonly {
    readonly resourcePath: string
    readonly blockId: string
    readonly start: number
    readonly end: number
  }[]
  readonly derivedData?: readonly unknown[]
  readonly includeOriginalWhenFits?: boolean
  readonly capacity?: VerifiedRouteCapacity
  readonly processingStep?: "chapter-map" | "book-synthesis" | "original-verification"
  readonly verificationTarget?: CoverageVerificationTarget
  readonly batchTarget?: BatchedVerificationTarget
  readonly batchManifestHash?: Digest
  readonly onValidated?: (job: RunningProviderJob) => void
}
