import { z } from "zod"

export const EXPERIMENTAL_COVERAGE_OPT_IN_VERSION = "experimental-window-coverage-opt-in-1" as const
export const ExperimentalCoverageOptIn = z
  .strictObject({
    version: z.literal(EXPERIMENTAL_COVERAGE_OPT_IN_VERSION),
    enabled: z.boolean().default(false),
  })
  .readonly()
export type ExperimentalCoverageOptIn = z.infer<typeof ExperimentalCoverageOptIn>
