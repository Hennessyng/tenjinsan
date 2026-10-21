import { types } from "node:util"
import { runInNewContext } from "node:vm"
import { QuestionsHandoffError } from "@reading-studio/generation/queue-questions"
import { ProviderError } from "@reading-studio/providers"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { scheduleApprovedSetup } from "./study-setup-send.ts"

const input = {
  setupId: "synthetic-setup",
  grantId: "synthetic-grant",
  ownerId: "synthetic-owner",
  installationId: "synthetic-installation",
}
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

function foreignProvider(code: string): unknown {
  return runInNewContext(
    `class ProviderError extends Error {
    constructor(code) { super(code); this.name = "ProviderError"; this.code = code }
  }; new ProviderError(code)`,
    { code },
  )
}

function foreignHandoff(code: string): unknown {
  return runInNewContext(
    `class QuestionsHandoffError extends Error {
    constructor(code) { super(code); this.name = "QuestionsHandoffError"; this.code = code }
  }; new QuestionsHandoffError(code)`,
    { code },
  )
}

it.each([
  "missing-credentials",
  "unsupported-model",
  "unsupported-settings",
  "outcome-unknown",
  "unauthorized",
  "input-limit",
  "subscription-unverified",
  "subscription-connection-changed",
])("preserves the allowlisted %s refusal from a native ProviderError in another realm", (code) => {
  // Given
  const error = foreignProvider(code)
  expect(types.isNativeError(error)).toBe(true)
  expect(error instanceof Error).toBe(false)
  expect(error instanceof ProviderError).toBe(false)
  // When
  const failure = scheduleApprovedSetup(() => {
    throw error
  }, input)
  // Then
  expect(failure).toBe(code)
})

it.each(["bank-incompatible", "unauthorized"])(
  "preserves %s from a native QuestionsHandoffError in another realm",
  (code) => {
    // Given
    const error = foreignHandoff(code)
    expect(types.isNativeError(error)).toBe(true)
    expect(error instanceof QuestionsHandoffError).toBe(false)
    // When
    const failure = scheduleApprovedSetup(() => {
      throw error
    }, input)
    // Then
    expect(failure).toBe(code)
  },
)

it.each([new ProviderError("unsupported-model"), new QuestionsHandoffError("bank-incompatible")])(
  "retains classification for existing same-realm domain errors: %s",
  (error) => {
    // Given / When
    const failure = scheduleApprovedSetup(() => {
      throw error
    }, input)
    // Then
    expect(failure).toBe(error.code)
  },
)

it.each([
  new TypeError("Synthetic infrastructure failure"),
  Object.assign(new TypeError("Synthetic coded infrastructure failure"), {
    code: "unsupported-model",
  }),
  Object.assign(new TypeError("Synthetic name-spoofed infrastructure failure"), {
    name: "ProviderError",
    code: "unsupported-model",
  }),
  foreignProvider("bank-incompatible"),
  foreignProvider("PRIVATE_DIAGNOSTIC_SENTINEL"),
  foreignHandoff("unsupported-model"),
])("keeps infrastructure and invalid-domain codes generic: %#", (error) => {
  // Given / When
  const failure = scheduleApprovedSetup(() => {
    throw error
  }, input)
  // Then
  expect(failure).toBe("scheduling-interrupted")
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
    "PRIVATE_DIAGNOSTIC_SENTINEL",
  )
})

it("does not treat an error-shaped data object as a domain Error", () => {
  // Given
  const error = { name: "ProviderError", code: "unsupported-model" }
  let thrown: unknown
  // When
  try {
    scheduleApprovedSetup(() => {
      throw error
    }, input)
  } catch (caught) {
    if (caught !== error) throw caught
    thrown = caught
  }
  // Then
  expect(thrown).toBe(error)
  expect(console.warn).not.toHaveBeenCalled()
})
