import { StudySetupRevision } from "@reading-studio/contracts"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { expect, it } from "vitest"
import { z } from "zod"
import { localRequestBytes, requireRouteCapacity, structuredRequest } from "../src/index.ts"
import {
  legacyLocalReservationBytes,
  localRequestBinding,
  localToolInput,
} from "../src/local-tool-request.ts"

it("reports the exact tool-input JSON quantity without an invented downstream padding certificate", () => {
  const request = structuredRequest({
    model: "synthetic-model",
    settings: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 1000,
      seed: null,
      reasoningEffort: "default",
    },
    instruction: "untrusted fixture input",
    schema: z.toJSONSchema(z.object({ value: z.string() })),
    blocks: [{ text: '早🧭\\"\n' }],
    signal: new AbortController().signal,
  })
  expect(localRequestBytes("chatgpt-subscription", request)).toBe(
    Buffer.byteLength(JSON.stringify(localToolInput("chatgpt-subscription", request)), "utf8"),
  )
  expect(legacyLocalReservationBytes("chatgpt-subscription", request)).toBe(
    Buffer.byteLength(JSON.stringify(localToolInput("chatgpt-subscription", request)), "utf8") +
      2048,
  )
})
it("binds model, schema, instructions, settings and destination independently", () => {
  const request = structuredRequest({
    model: "synthetic-model",
    settings: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 1000,
      seed: null,
      reasoningEffort: "default",
    },
    instruction: "fixture",
    schema: { type: "object" },
    blocks: [],
    signal: new AbortController().signal,
  })
  const route = {
    setupId: "s",
    grantId: "g",
    jobId: "j",
    capacityId: "c",
    destination: { accountId: "A" },
  }
  const binding = localRequestBinding(request, route)
  for (const changed of [
    { ...request, model: "another-model" },
    { ...request, schema: { type: "string" } },
    { ...request, prompt: "changed" },
    { ...request, settings: { ...request.settings, maxOutputTokens: 999 } },
  ])
    expect(localRequestBinding(changed, route)).not.toBe(binding)
  expect(localRequestBinding(request, { ...route, destination: { accountId: "B" } })).not.toBe(
    binding,
  )
})
it("rejects an interface-shaped but unclassified capacity object instead of calling it ready", () => {
  const setup = StudySetupRevision.parse(completeGraphFixtures("openrouter").setup)
  const unclassified = {
    id: "old-unscoped-certificate",
    provider: setup.analysis.provider,
    model: setup.analysis.model,
    destination: setup.analysis.destination,
    contextTokens: 100000,
    maxOutputTokens: 6000,
    maxRequestBytes: 32000,
    evidence: "A string is not full-assembly proof",
    countInputTokens: () => 1,
  }
  expect(() => requireRouteCapacity(setup, unclassified)).toThrow("capacity-unknown")
})
