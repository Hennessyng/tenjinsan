import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { fullBookServerFixture } from "./full-book-run-fixture.ts"

export async function fullBookConsentInput(f: ReturnType<typeof fullBookServerFixture>) {
  const response = await f.post("prepare", f.options)
  if (response.status !== 200)
    throw new TypeError(`Synthetic preparation refused: ${response.status}`)
  const review = z
    .object({
      reviewBinding: z.string(),
      consent: z.object({
        runtimeBinding: z.string(),
        recipientBinding: z.string(),
        planBinding: z.string(),
        omissionsHash: z.string(),
        maxAttempts: z.number(),
        priorSpent: z.number(),
        priorUnknown: z.number(),
        priorUsageUnknown: z.number(),
        priorHeld: z.number(),
        sourceVersion: z.number(),
        sourceCeiling: z.number(),
        coverage: z.enum(["complete", "partial"]),
        omissionCount: z.number(),
      }),
    })
    .parse(await response.json())
  return {
    submissionId: randomUUID(),
    options: f.options,
    reviewBinding: review.reviewBinding,
    acknowledgements: {
      ...review.consent,
      readableAndDerived: true,
      appBoundedNotProviderLimits: true,
      coverageAndOmissions: true,
      budgetAndUnknown: true,
    },
  }
}
