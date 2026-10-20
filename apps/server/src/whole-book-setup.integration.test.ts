import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { interviewFixture } from "./testing/interview-fixture.ts"
import { sourceViewerFixture } from "./testing/source-viewer-fixture.ts"

type Fixture = Awaited<ReturnType<typeof sourceViewerFixture>>
const fixtures: Fixture[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})
const settings = {
  temperature: 0,
  topP: 1,
  maxOutputTokens: 1000,
  seed: null,
  reasoningEffort: "default",
} as const
const Created = z.object({ setupId: z.string() })
const edition = {
  id: "edition-fixture",
  originalHash: "a".repeat(64),
  originalBlobHash: "a".repeat(64),
  title: "The art of paying attention",
}
const normalization = (id: string, resources: readonly unknown[]) => ({
  id,
  editionId: edition.id,
  editionHash: edition.originalHash,
  parserVersion: "parser-1",
  normalizerVersion: "normalizer-1",
  coverage: "partial" as const,
  resources,
})

async function open(options?: { readonly interview?: boolean }) {
  const fixture = options?.interview
    ? await interviewFixture({ providerAvailable: true })
    : await sourceViewerFixture({ providerAvailable: true })
  fixtures.push(fixture)
  const headers = { origin: fixture.origin, "content-type": "application/json" }
  const create = (revision: string, body: unknown) =>
    fetch(`${fixture.origin}/api/study-setup/${revision}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  const decide = (revision: string, setupId: string, body: unknown) =>
    fetch(`${fixture.origin}/api/study-setup/${revision}/${setupId}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  return { fixture, headers, create, decide }
}
const ownerOf = (fixture: Fixture) => {
  const study = fixture.storage.sources.listStudiesByEdition(edition.id)[0]
  if (!study) throw new TypeError("Missing study")
  return study.ownerId
}
function historicalPartial(fixture: Fixture, options?: { readonly granted?: boolean }) {
  fixture.storage.sources.appendSetup({
    parentRevisionId: null,
    record: {
      id: "setup-historical",
      studyId: "study-fixture",
      editionId: edition.id,
      analysis: {
        editionHash: edition.originalHash,
        normalizationRevisionId: "revision-fixture",
        scope: {
          kind: "partial",
          selected: [
            { resourcePath: "chapter-one.xhtml", blockIds: ["opening", "passage", "unsafe"] },
          ],
          exclusions: [{ resourcePath: "chapter-two.xhtml", blockIds: ["second"] }],
        },
        provider: "openai",
        model: "fixture",
        analysisPromptVersion: "analysis-1",
        analysisSchemaVersion: "analysis-1",
        settings,
      },
      generation: {
        promptVersion: "generation-1",
        schemaVersion: "generation-1",
        settings,
      },
    },
  })
  if (options?.granted) {
    const ownerId = ownerOf(fixture)
    const installationId = fixture.storage.sources.createInstallation({
      id: "installation-historical",
      ownerId,
    })
    fixture.storage.sources.appendGrant({
      id: "grant-setup-historical",
      kind: "active",
      setupRevisionId: "setup-historical",
      installationId,
      ownerId,
      categories: ["book-text"],
      approvedAt: "2026-01-01T00:00:00.000Z",
    })
  }
}

describe("normal creation", () => {
  it("creates one whole-book setup from only a provider choice, including supplementary text", async () => {
    // Given: an extraction with main chapters, an included supplementary part and one omission
    const { fixture, create } = await open()
    fixture.storage.sources.persistDocument({
      edition,
      normalization: normalization("revision-supplement", [
        {
          path: "chapter.xhtml",
          role: "main-chapter",
          status: "included",
          blocks: [
            { id: "c1", text: "Main one" },
            { id: "c2", text: "Main two" },
          ],
        },
        {
          path: "notes.xhtml",
          role: "supplementary",
          status: "included",
          blocks: [{ id: "n1", text: "Supplementary note" }],
        },
        { path: "plate.xhtml", role: "supplementary", status: "excluded", reason: "unsupported" },
      ]),
    })
    // When: no scope decision is supplied
    const response = await create("revision-supplement", { provider: "anthropic" })
    // Then
    expect(response.status).toBe(201)
    const id = Created.parse(await response.json()).setupId
    expect(fixture.storage.sources.getSetup(id)?.analysis.scope).toEqual({
      kind: "whole-document",
      selected: [
        { resourcePath: "chapter.xhtml", blockIds: ["c1", "c2"] },
        { resourcePath: "notes.xhtml", blockIds: ["n1"] },
      ],
      exclusions: [],
    })
    expect(fixture.storage.counts()).toMatchObject({
      setups: 1,
      grants: 0,
      runs: 0,
      jobs: 0,
      attempts: 0,
    })
  })

  it.each([
    [
      "JSON partial subset",
      { provider: "anthropic", scope: "partial", chapters: ["chapter-one.xhtml"] },
    ],
    ["JSON main-only", { provider: "anthropic", scope: "all-main-chapters" }],
    ["JSON chapters without scope", { provider: "anthropic", chapters: ["chapter-two.xhtml"] }],
    [
      "JSON whole with subset",
      { provider: "anthropic", scope: "whole-document", chapters: ["chapter-two.xhtml"] },
    ],
    ["JSON unknown scope", { provider: "anthropic", scope: "everything-but-appendix" }],
  ])("refuses a %s request without persisting any setup", async (_name, body) => {
    // Given
    const { fixture, create } = await open()
    // When
    const response = await create("revision-fixture", body)
    // Then
    expect(response.status).toBe(400)
    expect(fixture.storage.counts()).toMatchObject({ setups: 0, grants: 0, jobs: 0, attempts: 0 })
  })

  it("refuses a native form subset request without persisting any setup", async () => {
    // Given
    const { fixture } = await open()
    // When
    const response = await fetch(`${fixture.origin}/sources/revision-fixture/setup`, {
      method: "POST",
      headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        provider: "anthropic",
        scope: "partial",
        chapters: "chapter-one.xhtml",
      }),
      redirect: "manual",
    })
    // Then
    expect(response.status).toBe(400)
    expect(fixture.storage.counts().setups).toBe(0)
  })

  it("creates a whole-book setup from a native form that carries no scope", async () => {
    // Given
    const { fixture } = await open()
    // When
    const response = await fetch(`${fixture.origin}/sources/revision-fixture/setup`, {
      method: "POST",
      headers: { origin: fixture.origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ provider: "anthropic" }),
      redirect: "manual",
    })
    // Then
    expect(response.status).toBe(303)
    const setupId = new URL(response.headers.get("location") ?? "", fixture.origin).pathname
      .split("/")
      .at(-1)
    expect(fixture.storage.sources.getSetup(setupId)?.analysis.scope).toMatchObject({
      kind: "whole-document",
      selected: [
        { resourcePath: "chapter-one.xhtml", blockIds: ["opening", "passage", "unsafe"] },
        { resourcePath: "chapter-two.xhtml", blockIds: ["second"] },
      ],
      exclusions: [],
    })
  })
})

describe("extraction coverage", () => {
  it("lets a nonempty extraction with omissions proceed to Send without an extra acknowledgement", async () => {
    // Given: the fixture extraction omits appendix.xhtml
    const { fixture, create, decide } = await open()
    const id = Created.parse(
      await (await create("revision-fixture", { provider: "anthropic" })).json(),
    ).setupId
    // When: the review exposes the omission and the reader sends with only the decision
    const review = await fetch(`${fixture.origin}/api/study-setup/revision-fixture/${id}`)
    const sent = await decide("revision-fixture", id, { decision: "send" })
    // Then
    expect(await review.json()).toMatchObject({
      normalization: {
        coverage: "partial",
        resources: expect.arrayContaining([
          expect.objectContaining({ path: "appendix.xhtml", status: "excluded" }),
        ]),
      },
    })
    expect(sent.status).toBe(200)
    expect(fixture.storage.sources.getGrant(`grant-${id}`)?.kind).toBe("active")
  })

  it.each([
    [
      "only textless anchors",
      [
        {
          path: "anchors.xhtml",
          role: "main-chapter",
          status: "included",
          blocks: [{ id: "anchor", text: "", originalFragment: "anchor" }],
        },
      ],
    ],
    [
      "only omitted resources",
      [{ path: "scan.xhtml", role: "main-chapter", status: "excluded", reason: "textless" }],
    ],
  ])("cannot create a study from an empty extraction with %s", async (_name, resources) => {
    // Given
    const { fixture, create } = await open()
    fixture.storage.sources.persistDocument({
      edition,
      normalization: normalization("revision-empty", resources),
    })
    // When
    const response = await create("revision-empty", { provider: "anthropic" })
    // Then
    expect(response.status).toBe(422)
    expect(fixture.storage.counts()).toMatchObject({ setups: 0, grants: 0, jobs: 0, attempts: 0 })
  })
})

describe("historical setups", () => {
  it.each([false, true])(
    "keeps a stored partial setup (granted: %s) unchanged and reconfigures into a new whole-book setup with no grant",
    async (granted) => {
      // Given
      const { fixture, create } = await open()
      historicalPartial(fixture, { granted })
      const setupBefore = structuredClone(fixture.storage.sources.getSetup("setup-historical"))
      const grantBefore = structuredClone(
        fixture.storage.sources.getGrant("grant-setup-historical"),
      )
      // When
      const response = await create("revision-fixture", { provider: "anthropic" })
      // Then
      expect(response.status).toBe(201)
      const id = Created.parse(await response.json()).setupId
      expect(id).not.toBe("setup-historical")
      expect(fixture.storage.sources.getSetup(id)?.analysis.scope.kind).toBe("whole-document")
      expect(fixture.storage.sources.getGrant(`grant-${id}`)).toBeNull()
      expect(fixture.storage.sources.getSetup("setup-historical")).toEqual(setupBefore)
      expect(fixture.storage.sources.getGrant("grant-setup-historical")).toEqual(grantBefore)
      expect(fixture.storage.counts()).toMatchObject({
        grants: granted ? 1 : 0,
        jobs: 0,
        attempts: 0,
      })
    },
  )

  it("keeps existing interviews and answers intact without regenerating or adding analysis", async () => {
    // Given: an interview and answer bound to a historical partial analysis
    const { fixture, create } = await open({ interview: true })
    historicalPartial(fixture)
    fixture.storage.interviews.save({
      studyId: "study-fixture",
      interviewId: "interview-fixture",
      answer: {
        questionId: "angle",
        questionRevisionId: "angle-v1",
        kind: "custom",
        text: "Private context",
      },
    })
    const before = {
      interview: structuredClone(fixture.storage.interviews.latest("study-fixture")),
      answers: structuredClone(fixture.storage.interviews.answers("interview-fixture")),
      counts: fixture.storage.counts(),
    }
    // When
    const response = await create("revision-fixture", { provider: "anthropic" })
    // Then
    expect(response.status).toBe(201)
    expect(fixture.storage.interviews.latest("study-fixture")).toEqual(before.interview)
    expect(fixture.storage.interviews.answers("interview-fixture")).toEqual(before.answers)
    expect(fixture.storage.counts()).toMatchObject({
      analyses: before.counts.analyses,
      answers: before.counts.answers,
      jobs: 0,
      attempts: 0,
      grants: 0,
    })
  })
})

describe("revision routes", () => {
  it("forks a historical partial study into a fresh whole-book setup without changing the original", async () => {
    const { fixture, headers } = await open()
    historicalPartial(fixture, { granted: true })
    const before = fixture.storage.sources.getSetup("setup-historical")
    const response = await fetch(`${fixture.origin}/api/revisions/study-fixture/fork`, {
      method: "POST",
      headers,
      body: JSON.stringify({ expectedSetupRevisionId: "setup-historical" }),
    })
    expect(response.status).toBe(201)
    const fork = z.object({
      setup: z.object({
        id: z.string(),
        analysis: z.object({ scope: z.object({ kind: z.literal("whole-document") }) }),
      }),
      grant: z.null(),
    })
    const result = fork.parse(await response.json())
    expect(result.setup.id).not.toBe("setup-historical")
    expect(fixture.storage.sources.getSetup("setup-historical")).toEqual(before)
    expect(fixture.storage.counts()).toMatchObject({ grants: 1, jobs: 0, attempts: 0 })
  })

  it("refuses a client-authored subset analysis on the raw revision route", async () => {
    // Given
    const { fixture, headers } = await open()
    historicalPartial(fixture)
    const setup = fixture.storage.sources.getSetup("setup-historical")
    if (!setup) throw new TypeError("Missing setup")
    // When
    const response = await fetch(`${fixture.origin}/api/revisions/study-fixture/setup`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        expectedSetupRevisionId: setup.id,
        analysis: { ...setup.analysis, provider: "anthropic", model: "claude-sonnet-4-6" },
        generation: setup.generation,
      }),
    })
    // Then
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(response.status).toBeLessThan(500)
    expect(fixture.storage.counts().setups).toBe(1)
  })

  it("replaces a historical partial scope with whole-book scope when the reader reconfigures the provider", async () => {
    // Given
    const { fixture, headers } = await open()
    historicalPartial(fixture)
    const before = structuredClone(fixture.storage.sources.getSetup("setup-historical"))
    // When
    const response = await fetch(`${fixture.origin}/api/revision-page/study-fixture`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "provider",
        provider: "anthropic",
        expectedSetupRevisionId: "setup-historical",
      }),
    })
    // Then
    expect(response.status).toBe(200)
    const latest = fixture.storage.sources.getLatestSetup("study-fixture")
    expect(latest?.id).not.toBe("setup-historical")
    expect(latest?.analysis.scope).toMatchObject({ kind: "whole-document", exclusions: [] })
    expect(fixture.storage.sources.getSetup("setup-historical")).toEqual(before)
    expect(fixture.storage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
  })
})
