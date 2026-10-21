import { DiscoveryDraft } from "@reading-studio/generation/questions"
import {
  localRequestBytes,
  ProviderReceipt,
  type StructuredRequest,
} from "@reading-studio/providers"
import { afterEach, expect, it, vi } from "vitest"
import { questionsStage } from "../src/production-questions.ts"
import { questionRepairFixture, requestRepair } from "./question-repair-fixture.ts"

const fixtures: Awaited<ReturnType<typeof questionRepairFixture>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fixture of fixtures.splice(0)) await fixture.close()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
async function given() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Network forbidden")
    }),
  )
  const fixture = await questionRepairFixture()
  fixtures.push(fixture)
  return fixture
}

it("locates the observed duplicate revision constraint without accepting it", async () => {
  // Given
  const { bad } = await given()
  // When
  const result = DiscoveryDraft.safeParse(bad)
  // Then
  expect(result.success).toBe(false)
  if (result.success) throw new TypeError("Duplicate revision IDs must remain invalid")
  expect(result.error.issues).toContainEqual(
    expect.objectContaining({
      code: "custom",
      path: ["lenses", 1, "revisionId"],
      params: { rule: "unique-question-revision-id" },
    }),
  )
})

it.each(["duplicate-revision", "invalid-json"])(
  "sends safe structured feedback for %s within the existing two-attempt budget",
  async (failure) => {
    // Given
    const fixture = await given()
    const { storage, setup, job, bad, good, worker } = fixture
    const requests: StructuredRequest[] = []
    const dispatch = vi.fn(async (request: StructuredRequest): Promise<ProviderReceipt> => {
      requests.push(request)
      const repair = requestRepair(request)
      const corrected = repair?.issues.some((issue) =>
        failure === "invalid-json"
          ? issue.code === "invalid-json"
          : issue.rule === "unique-question-revision-id",
      )
      return {
        kind: "output",
        text: corrected
          ? JSON.stringify(good)
          : failure === "invalid-json"
            ? '{"groups":[{"id":"one"} {"id":"two"}]}'
            : JSON.stringify(bad),
        usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
      }
    })
    // When
    const result = await worker(dispatch).runNext()
    // Then
    expect(result.kind === "provider" && result.job.state).toBe("completed")
    expect(requests).toHaveLength(2)
    const first = requests[0]
    const second = requests[1]
    if (!first || !second) throw new TypeError("Synthetic repair requests missing")
    expect(requestRepair(first)).toBeNull()
    const repair = requestRepair(second)
    expect(repair).not.toBeNull()
    expect(JSON.stringify(repair)).not.toContain("NATIVE_RESPONSE_DIAGNOSTIC_SENTINEL")
    if (failure === "duplicate-revision")
      expect(repair?.issues).toContainEqual({
        code: "custom",
        path: ["lenses", 1, "revisionId"],
        rule: "unique-question-revision-id",
      })
    expect(first.prompt).not.toBe(second.prompt)
    expect(storage.execution.listAttempts(job.runId)).toHaveLength(2)
    const hashes = storage.execution.listAttempts(job.runId).map((attempt) => {
      const body = storage.execution.getAttemptReceipt(attempt.id)
      if (!body) throw new TypeError("Synthetic recorded receipt missing")
      return ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body))).inputCoverage
        ?.requestHash
    })
    expect(hashes.every((hash) => hash !== undefined)).toBe(true)
    expect(new Set(hashes).size).toBe(2)
    expect(storage.interviews.latest(setup.studyId)?.steps).toHaveLength(2)
    expect(
      storage.execution.listSetupJobs(setup.id).filter((entry) => entry.stage === "analysis"),
    ).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  },
)

it("still rejects a second invalid response with no bank or third dispatch", async () => {
  // Given
  const { storage, setup, job, bad, worker } = await given()
  const dispatch = vi.fn(
    async (): Promise<ProviderReceipt> => ({
      kind: "output",
      text: JSON.stringify(bad),
      usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
    }),
  )
  // When
  const result = await worker(dispatch).runNext()
  // Then
  expect(result.kind === "provider" && result.job.state === "failed" && result.job.error.code).toBe(
    "malformed-output",
  )
  expect(dispatch).toHaveBeenCalledTimes(2)
  expect(storage.execution.listAttempts(job.runId)).toHaveLength(2)
  expect(storage.interviews.latest(setup.studyId)).toBeNull()
})

it("measures the feedback envelope before reserving another attempt", async () => {
  // Given
  const { storage, job, bad, worker } = await given()
  const dispatch = vi.fn(
    async (): Promise<ProviderReceipt> => ({
      kind: "output",
      text: JSON.stringify(bad),
      usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
    }),
  )
  // When
  const result = await worker(dispatch, {
    measure: async (request) =>
      requestRepair(request) ? 32001 : localRequestBytes("chatgpt-subscription", request),
  }).runNext()
  // Then
  expect(result.kind === "provider" && result.job.state === "failed" && result.job.error.code).toBe(
    "input-limit",
  )
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(storage.execution.listAttempts(job.runId)).toHaveLength(1)
})

it("rebuilds repair feedback after interruption with the prepared attempt preserved", async () => {
  // Given
  const { storage, setup, job, bad, good, worker } = await given()
  const dispatch = vi.fn(
    async (request: StructuredRequest): Promise<ProviderReceipt> => ({
      kind: "output",
      text: JSON.stringify(requestRepair(request) ? good : bad),
      usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
    }),
  )
  const reserve = storage.execution.reserveAttempt.bind(storage.execution)
  const interrupt = vi.spyOn(storage.execution, "reserveAttempt").mockImplementation((input) => {
    const result = reserve(input)
    if (result.kind === "prepared" && result.attempt.reservation === 2)
      throw new TypeError("Synthetic repair interruption")
    return result
  })
  await expect(
    worker(dispatch, { clock: () => new Date(Date.now() - 240000) }).runNext(),
  ).rejects.toThrow("Synthetic repair interruption")
  interrupt.mockRestore()
  expect(storage.execution.listAttempts(job.runId).map((attempt) => attempt.state)).toEqual([
    "response-received",
    "prepared",
  ])
  // When
  const result = await worker(dispatch).runNext()
  // Then
  expect(result.kind === "provider" && result.job.state).toBe("completed")
  expect(dispatch).toHaveBeenCalledTimes(2)
  expect(storage.execution.listAttempts(job.runId)).toHaveLength(2)
  expect(storage.interviews.latest(setup.studyId)?.steps).toHaveLength(2)
})

it("does not weaken citation membership while preparing repair feedback", async () => {
  // Given
  const { storage, job, good } = await given()
  const first = good.lenses[0]
  const span = first?.sources[0]
  if (!first || !span) throw new TypeError("Synthetic citation missing")
  // When
  const result = questionsStage(storage, job).schema.safeParse({
    ...good,
    lenses: [{ ...first, sources: [{ ...span, start: span.start + 1 }] }],
  })
  // Then
  expect(result.success).toBe(false)
})
