import type { Job } from "@reading-studio/contracts"
import type { z } from "zod"
import type { ProviderAdapter } from "./adapter.ts"
import type { ProviderAuthority } from "./authorization.ts"
import type { ProviderName } from "./catalog.ts"

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
  readonly instruction: string
  readonly signal?: AbortSignal
  readonly sourceWindow?: { readonly blockId: string; readonly start: number; readonly end: number }
  readonly onValidated?: (job: RunningProviderJob) => void
}
