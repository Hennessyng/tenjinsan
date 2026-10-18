import { DEFAULT_ARCHIVE_LIMITS } from "@reading-studio/ingestion/archive"
import { docxEntries, pdfFixture, zipFixture } from "@reading-studio/ingestion/test-support"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { uploadHarness } from "./testing/upload-harness.ts"

const harnesses: Awaited<ReturnType<typeof uploadHarness>>[] = []
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close()
})

it("retains actual PDF page locations in no-JS review and byte-limit refusal", async () => {
  // Given
  const harness = await uploadHarness({
    providerAvailable: true,
    queueAnalysis: true,
    limits: DEFAULT_ARCHIVE_LIMITS,
  })
  harnesses.push(harness)
  const upload = await fetch(`${harness.origin}/api/imports/upload`, {
    method: "POST",
    headers: { ...harness.headers, "content-type": "application/pdf" },
    body: Buffer.from(
      pdfFixture(["\\\\".repeat(12_000)])
        .toString("utf8")
        .replace("/F1 12 Tf", "/F1 .1 Tf"),
    ),
  })
  expect(upload.status).toBe(202)
  const revision = z
    .object({ normalizationRevisionId: z.string() })
    .parse(await upload.json()).normalizationRevisionId
  const extracted = harness.sourceStorage.sources.getNormalization(revision)
  expect(
    extracted?.resources.flatMap((resource) =>
      resource.status === "included" ? resource.blocks.map((block) => block.text.length) : [],
    ),
  ).toEqual([12_000])
  const draft = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/json" },
    body: JSON.stringify({ provider: "anthropic", scope: "whole-document" }),
  })
  expect(draft.status).toBe(201)
  const setupId = z.object({ setupId: z.string() }).parse(await draft.json()).setupId
  // When
  const review = await (
    await fetch(`${harness.origin}/sources/${revision}/setup/${setupId}`)
  ).text()
  const refusal = await fetch(`${harness.origin}/sources/${revision}/setup/${setupId}`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/x-www-form-urlencoded" },
    body: "decision=send",
  })
  // Then
  expect(review).toContain("PDF page 1")
  expect(refusal.status).toBe(422)
  const body = await refusal.text()
  expect(body).toContain("PDF page 1")
  expect(body).toContain("UTF-16 [0, 12000)")
  expect(harness.sourceStorage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
})

it("shows extraction omissions, original warning and selected locations in no-JS source and review pages", async () => {
  // Given
  const harness = await uploadHarness({
    providerAvailable: true,
    limits: DEFAULT_ARCHIVE_LIMITS,
    queueAnalysis: true,
  })
  harnesses.push(harness)
  const bytes = zipFixture([
    ...docxEntries.map((entry) =>
      entry.name === "word/document.xml"
        ? {
            ...entry,
            text: entry.text
              .replace("Early heading", "あ".repeat(12_000))
              .replace("</w:p>", "</w:p><w:drawing/>"),
          }
        : entry,
    ),
    {
      name: "word/<img onerror=alert(1)>.xml",
      text: '<w:custom xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    },
  ])
  const upload = await fetch(`${harness.origin}/api/imports/upload`, {
    method: "POST",
    headers: {
      ...harness.headers,
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    body: bytes,
  })
  expect(upload.status).toBe(202)
  const revision = z
    .object({ normalizationRevisionId: z.string() })
    .parse(await upload.json()).normalizationRevisionId
  const draft = await fetch(`${harness.origin}/api/study-setup/${revision}`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/json" },
    body: JSON.stringify({ provider: "anthropic", scope: "whole-document" }),
  })
  expect(draft.status).toBe(201)
  const setupId = z.object({ setupId: z.string() }).parse(await draft.json()).setupId
  // When
  const source = await (await fetch(`${harness.origin}/sources/${revision}`)).text()
  const review = await (
    await fetch(`${harness.origin}/sources/${revision}/setup/${setupId}`)
  ).text()
  const refused = await fetch(`${harness.origin}/sources/${revision}/setup/${setupId}`, {
    method: "POST",
    headers: { origin: harness.origin, "content-type": "application/x-www-form-urlencoded" },
    body: "decision=send",
  })
  const body = await refused.text()
  // Then
  expect(source).toContain("word/unsupported.xml")
  expect(source).toContain("unsupported-part")
  expect(source).toContain("removed:drawing")
  expect(source).toContain("&lt;img onerror=alert(1)&gt;")
  expect(source).not.toContain("<img onerror")
  expect(source).toContain("paragraph 1")
  expect(review).toContain("partial")
  expect(review).toContain("word/unsupported.xml")
  expect(review).toContain("unsupported-part")
  expect(review).toContain("removed:drawing")
  expect(review).toContain("&lt;img onerror=alert(1)&gt;")
  expect(review).not.toContain("<img onerror")
  expect(review).toContain("Original-file attachment unavailable")
  expect(review).toContain("paragraph 1")
  expect(refused.status).toBe(422)
  expect(body).toContain("paragraph 1")
  expect(body).toContain("word/document.xml")
  expect(body).toContain("UTF-16 [0, 12000)")
  expect(harness.sourceStorage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
})
