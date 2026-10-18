import { DEFAULT_ARCHIVE_LIMITS } from "@reading-studio/ingestion/archive"
import { docxEntries, epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { uploadHarness } from "./testing/upload-harness.ts"

const harnesses: Awaited<ReturnType<typeof uploadHarness>>[] = []
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close()
})

async function draft(bytes: Buffer<ArrayBuffer>, media: string) {
  const harness = await uploadHarness({
    providerAvailable: true,
    limits: DEFAULT_ARCHIVE_LIMITS,
    queueAnalysis: true,
  })
  harnesses.push(harness)
  const uploaded = await fetch(`${harness.origin}/api/imports/upload`, {
    method: "POST",
    headers: { ...harness.headers, "content-type": media },
    body: bytes,
  })
  expect(uploaded.status).toBe(202)
  const revision = z
    .object({ normalizationRevisionId: z.string() })
    .parse(await uploaded.json()).normalizationRevisionId
  const headers = { origin: harness.origin, "content-type": "application/json" }
  const response = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "anthropic", scope: "whole-document" }),
  })
  expect(response.status).toBe(201)
  const setupId = z.object({ setupId: z.string() }).parse(await response.json()).setupId
  const send = () =>
    fetch(`${harness.origin}/api/study-setup/${revision}/${setupId}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "send" }),
    })
  return { harness, revision, setupId, headers, send }
}

it("queues real analysis after importing DOCX with ordinary blank paragraphs", async () => {
  // Given
  const bytes = zipFixture(
    docxEntries.map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            text: entry.text.replace("</w:p>", "</w:p><w:p/><w:p><w:r><w:t>   </w:t></w:r></w:p>"),
          }
        : entry,
    ),
  )
  const { harness, revision, setupId, send } = await draft(
    bytes,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  )
  // When
  const response = await send()
  // Then
  expect(response.status).toBe(200)
  expect(harness.sourceStorage.sources.getGrant(`grant-${setupId}`)?.kind).toBe("active")
  expect(harness.sourceStorage.counts()).toMatchObject({ jobs: 4, attempts: 0 })
  const normalization = harness.sourceStorage.sources.getNormalization(revision)
  const blocks =
    normalization?.resources.flatMap((resource) =>
      resource.status === "included" ? resource.blocks : [],
    ) ?? []
  expect(blocks.every((block) => block.text.trim().length > 0)).toBe(true)
  expect(blocks.find((block) => block.text === "Middle list")?.locator).toMatchObject({
    kind: "docx",
    paragraph: 4,
  })
})

it("keeps meaningful EPUB anchors without treating empty locators as analysis windows", async () => {
  // Given
  const bytes = zipFixture(
    epubEntries.map((entry) =>
      entry.name === "book/chapter.xhtml"
        ? { ...entry, text: entry.text.replace("<body>", '<body><a id="retained-anchor"/>') }
        : entry,
    ),
  )
  const { harness, revision, send } = await draft(bytes, "application/epub+zip")
  // When
  const response = await send()
  // Then
  expect(response.status).toBe(200)
  const normalization = harness.sourceStorage.sources.getNormalization(revision)
  expect(
    normalization?.resources.flatMap((resource) =>
      resource.status === "included" ? resource.blocks : [],
    ),
  ).toContainEqual(expect.objectContaining({ text: "", originalFragment: "retained-anchor" }))
  expect(harness.sourceStorage.counts()).toMatchObject({ jobs: 2, attempts: 0 })
})

it.each([1, 2])(
  "refuses an over-window imported TXT before granting, including retry %s",
  async (tries) => {
    // Given
    const text = "x".repeat(128 * 12_000 + 1)
    const { harness, revision, setupId, headers, send } = await draft(
      Buffer.from(text),
      "text/plain",
    )
    // When
    const responses = []
    for (let attempt = 0; attempt < tries; attempt++) {
      const response = await send()
      responses.push({
        status: response.status,
        body: await response.text(),
        grant: harness.sourceStorage.sources.getGrant(`grant-${setupId}`)?.kind ?? null,
      })
    }
    // Then
    for (const response of responses) {
      expect({ status: response.status, grant: response.grant }).toEqual({
        status: 422,
        grant: null,
      })
      const refusal = z
        .object({
          error: z.literal("scope-limit"),
          coverage: z.object({
            transmission: z.literal("not-sent"),
            reason: z.literal("analysis-window-limit"),
            requiredWindows: z.number().int(),
            maxWindows: z.literal(128),
            unsentRanges: z.array(
              z.object({
                resourcePath: z.string(),
                blockId: z.string(),
                start: z.number(),
                end: z.number(),
              }),
            ),
          }),
        })
        .parse(JSON.parse(response.body))
      expect(refusal.coverage.requiredWindows).toBeGreaterThan(128)
      expect(
        refusal.coverage.unsentRanges.reduce((sum, range) => sum + range.end - range.start, 0),
      ).toBe(text.length)
    }
    expect(harness.sourceStorage.sources.getGrant(`grant-${setupId}`)).toBeNull()
    expect(harness.sourceStorage.counts()).toMatchObject({
      grants: 0,
      jobs: 0,
      runs: 0,
      attempts: 0,
    })
    const review = await fetch(`${harness.origin}/api/study-setup/${revision}/${setupId}`, {
      headers,
    })
    expect(review.status).toBe(200)
  },
)

it("renders Japanese non-API preparation refusal without granting or queuing", async () => {
  // Given: a real imported source exceeds the analysis window limit.
  const { harness, revision, setupId } = await draft(
    Buffer.from("x".repeat(128 * 12_000 + 1)),
    "text/plain",
  )
  // When: the Japanese form route attempts Send.
  const response = await fetch(`${harness.origin}/sources/${revision}/setup/${setupId}?lang=ja`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/x-www-form-urlencoded" },
    body: "decision=send",
  })
  // Then: fixed UI follows the requested language; codes and safety remain unchanged.
  expect(response.status).toBe(422)
  const body = await response.text()
  expect(body).toContain('lang="ja"')
  expect(body).toContain("資料の準備を中止しました")
  expect(body).not.toContain("Source preparation stopped")
  expect(body).toContain("analysis-window-limit")
  expect(body).toContain(`href="/sources/${revision}/setup?lang=ja"`)
  expect(harness.sourceStorage.sources.getGrant(`grant-${setupId}`)).toBeNull()
  expect(harness.sourceStorage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
})

it("allows a newly reviewed smaller DOCX scope after preparation refuses the whole document", async () => {
  // Given
  const bytes = zipFixture(
    docxEntries.map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            text: entry.text.replace("Early heading", "x".repeat(128 * 12_000 + 1)),
            deflate: true,
          }
        : entry,
    ),
  )
  const { harness, revision, setupId, headers, send } = await draft(
    bytes,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  )
  const refused = await send()
  expect(refused.status).toBe(422)
  const smaller = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: "anthropic",
      scope: "partial",
      chapters: ["word/header1.xml"],
    }),
  })
  expect(smaller.status).toBe(201)
  const current = z.object({ setupId: z.string() }).parse(await smaller.json()).setupId
  // When
  const response = await fetch(`${harness.origin}/api/study-setup/${revision}/${current}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "send" }),
  })
  // Then
  expect(response.status).toBe(200)
  expect(harness.sourceStorage.sources.getGrant(`grant-${setupId}`)).toBeNull()
  expect(harness.sourceStorage.sources.getGrant(`grant-${current}`)?.kind).toBe("active")
  expect(harness.sourceStorage.counts()).toMatchObject({ grants: 1, jobs: 1, attempts: 0 })
})
