import { expect, it } from "vitest"
import {
  AnalysisCacheInput,
  analysisCacheKey,
  StudySetupRevision,
  TransmissionAuthorization,
} from "../src/index.ts"

const destination = {
  provider: "chatgpt-subscription",
  accountId: "account-a",
  workspaceId: "workspace-a",
  installationId: "installation-a",
  connectionRevision: 0,
  billingRoute: "subscription-allowance",
} as const
const analysis = {
  editionHash: "a".repeat(64),
  normalizationRevisionId: "normalization-a",
  scope: {
    kind: "whole-document",
    selected: [{ resourcePath: "source.txt", blockIds: ["block-a"] }],
    exclusions: [],
  },
  provider: destination.provider,
  model: "account-offered-model",
  destination,
  analysisPromptVersion: "1",
  analysisSchemaVersion: "1",
  settings: {
    temperature: 0,
    topP: 1,
    maxOutputTokens: 6000,
    seed: null,
    reasoningEffort: "default",
  },
} as const
const setup = {
  id: "setup-a",
  studyId: "study-a",
  editionId: "edition-a",
  analysis,
  generation: { promptVersion: "1", schemaVersion: "1", settings: analysis.settings },
}
const grant = {
  id: "grant-a",
  kind: "active",
  setupRevisionId: setup.id,
  installationId: destination.installationId,
  ownerId: "owner-a",
  categories: ["book-text"],
  approvedAt: "2026-10-19T00:00:00Z",
  destination,
}

it("accepts exact subscription consent without treating it as route eligibility", () => {
  // Given
  const input = {
    setup,
    grant,
    installationId: destination.installationId,
    ownerId: grant.ownerId,
    categories: ["book-text"],
  }
  // When
  const result = TransmissionAuthorization.safeParse(input)
  // Then
  expect(result.success).toBe(true)
})

it.each([
  { accountId: "account-b" },
  { workspaceId: "workspace-b" },
  { connectionRevision: 1 },
  { installationId: "installation-b" },
  { provider: "claude-subscription" },
  { billingRoute: "api" },
])("rejects consent when destination changes: %j", (patch) => {
  // Given
  const changed = { ...grant, destination: { ...destination, ...patch } }
  // When
  const result = TransmissionAuthorization.safeParse({
    setup,
    grant: changed,
    installationId: destination.installationId,
    ownerId: grant.ownerId,
    categories: ["book-text"],
  })
  // Then
  expect(result.success).toBe(false)
})

it("requires destination identity on subscription setups", () => {
  // Given
  const { destination: _destination, ...unbound } = analysis
  // When
  const result = StudySetupRevision.safeParse({ ...setup, analysis: unbound })
  // Then
  expect(result.success).toBe(false)
})

it.each([{ accountId: "account-b" }, { workspaceId: null }, { connectionRevision: 1 }])(
  "separates cached analysis when subscription destination changes: %j",
  (patch) => {
    // Given
    const original = AnalysisCacheInput.parse(analysis)
    const changed = AnalysisCacheInput.parse({
      ...analysis,
      destination: { ...destination, ...patch },
    })
    // When
    const key = analysisCacheKey(changed)
    // Then
    expect(key).not.toBe(analysisCacheKey(original))
  },
)

it("rejects credential material in consent identity", () => {
  // Given
  const contaminated = { ...destination, accessToken: "synthetic-secret" }
  // When
  const result = StudySetupRevision.safeParse({
    ...setup,
    analysis: { ...analysis, destination: contaminated },
  })
  // Then
  expect(result.success).toBe(false)
})

it("accepts provider-managed billing only with matching explicit destination consent", () => {
  // Given
  const managed = { ...destination, billingRoute: "subscription-provider-managed" }
  const approved = { ...setup, analysis: { ...analysis, destination: managed } }
  // When
  const result = TransmissionAuthorization.safeParse({
    setup: approved,
    grant: { ...grant, destination: managed },
    installationId: destination.installationId,
    ownerId: grant.ownerId,
    categories: ["book-text"],
  })
  // Then
  expect(result.success).toBe(true)
  expect(
    TransmissionAuthorization.safeParse({
      setup: approved,
      grant,
      installationId: destination.installationId,
      ownerId: grant.ownerId,
      categories: ["book-text"],
    }).success,
  ).toBe(false)
})
