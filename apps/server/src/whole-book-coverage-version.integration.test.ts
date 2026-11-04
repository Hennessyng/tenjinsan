import { EXPERIMENTAL_COVERAGE_OPT_IN_VERSION } from "@reading-studio/contracts"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { managedServerChoice } from "./testing/managed-server-session.ts"
import { uploadHarness } from "./testing/upload-harness.ts"

const harnesses: Awaited<ReturnType<typeof uploadHarness>>[] = []
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close()
})

it("defaults fresh drafts to bounded version4 without issuing a grant or accepting version3 overrides", async () => {
  // Given
  const harness = await uploadHarness({
    providerAvailable: true,
    localSubscriptions: true,
    managedChatGPT: true,
    managedCapacity: true,
  })
  harnesses.push(harness)
  const imported = await fetch(`${harness.origin}/api/imports/upload`, {
    method: "POST",
    headers: { ...harness.headers, "content-type": "text/plain" },
    body: "A synthetic rule.\n\nAn exception follows.",
  })
  const revision = z
    .object({ normalizationRevisionId: z.string() })
    .parse(await imported.json()).normalizationRevisionId
  // When
  const response = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/json" },
    body: JSON.stringify(managedServerChoice),
  })
  const id = z.object({ setupId: z.string() }).parse(await response.json()).setupId
  // Then
  expect(response.status).toBe(201)
  expect(harness.sourceStorage.sources.getSetup(id)?.analysis.processing?.synthesisVersion).toBe(
    "batched-original-check-4",
  )
  expect(harness.sourceStorage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
  const override = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/json" },
    body: JSON.stringify({
      ...managedServerChoice,
      synthesisVersion: "windows-original-check-3",
      allowExperimentalCoverage: true,
    }),
  })
  expect(override.status).toBe(400)
  const markerOverride = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/json" },
    body: JSON.stringify({
      ...managedServerChoice,
      experimentalCoverageOptIn: { version: EXPERIMENTAL_COVERAGE_OPT_IN_VERSION, enabled: true },
    }),
  })
  expect(markerOverride.status).toBe(400)
  expect(harness.sourceStorage.counts()).toMatchObject({
    setups: 1,
    grants: 0,
    jobs: 0,
    attempts: 0,
  })
})
