import { readdir, readFile } from "node:fs/promises"
import { request } from "node:http"
import { join } from "node:path"
import { epubEntries, zipFixture } from "@reading-studio/ingestion/test-support"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { uploadHarness } from "./testing/upload-harness.ts"

let harness: Awaited<ReturnType<typeof uploadHarness>>
beforeAll(async () => {
  harness = await uploadHarness()
})
afterAll(async () => {
  await harness?.close()
})

describe("HTTP EPUB upload", () => {
  it("retains a queued original when an authenticated owner uploads", async () => {
    // Given
    const bytes = zipFixture(epubEntries)
    // When
    const response = await fetch(`${harness.origin}/api/imports/upload`, {
      method: "POST",
      headers: {
        ...harness.headers,
        "content-disposition": 'attachment; filename="../../escape.epub"',
      },
      body: bytes,
    })
    // Then
    expect(response.status).toBe(202)
    const receipt = z
      .object({ id: z.string(), state: z.literal("queued"), sha256: z.string().length(64) })
      .parse(await response.json())
    expect(await readFile(join(harness.root, receipt.id, "original.epub"))).toEqual(bytes)
    expect(await readFile(join(harness.root, receipt.id, "queued.json"), "utf8")).toContain(
      receipt.sha256,
    )
    expect(await readdir(harness.directory)).not.toContain("escape.epub")
  })

  it("persists an accepted EPUB as a normal source without test-mode flags", async () => {
    const bytes = zipFixture(epubEntries)
    const response = await fetch(`${harness.origin}/api/imports/upload`, {
      method: "POST",
      headers: harness.headers,
      body: bytes,
    })
    expect(response.status).toBe(202)
    expect(harness.sourceStorage.counts().editions).toBeGreaterThan(0)
    expect(harness.sourceStorage.counts().studies).toBeGreaterThan(0)
    const receipt = z.object({ sha256: z.string().length(64) }).parse(await response.json())
    expect(await readFile(harness.sourceStorage.blobs.pathFor(receipt.sha256))).toEqual(bytes)
  })

  it.each([
    ["traversal", zipFixture([...epubEntries, { name: "../outside.txt", text: "attack" }]), 422],
    [
      "bomb",
      zipFixture([
        ...epubEntries,
        { name: "bomb.txt", text: "x".repeat(100000), deflate: true, size: 1 },
      ]),
      413,
    ],
    ["truncated", zipFixture(epubEntries).subarray(0, -10), 422],
    ["compressed size", Buffer.alloc(8193), 413],
  ])("rejects %s without leaving an intake directory", async (_label, body, status) => {
    // Given
    const before = await readdir(harness.root)
    // When
    const response = await fetch(`${harness.origin}/api/imports/upload`, {
      method: "POST",
      headers: harness.headers,
      body,
    })
    // Then
    expect(response.status).toBe(status)
    expect(await readdir(harness.root)).toEqual(before)
  })

  it("bounds a chunked request without trusting Content-Length", async () => {
    // Given
    const before = await readdir(harness.root)
    // When
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = request(
        `${harness.origin}/api/imports/upload`,
        { method: "POST", headers: harness.headers },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        },
      )
      outgoing.on("error", reject)
      outgoing.write(Buffer.alloc(4096))
      outgoing.end(Buffer.alloc(4097))
    })
    // Then
    expect(status).toBe(413)
    expect(await readdir(harness.root)).toEqual(before)
  })

  it.each([
    ["anonymous", { "content-type": "application/epub+zip" }, 401],
    ["cross-origin", { origin: "https://attacker.example" }, 403],
    ["multipart", { "content-type": "multipart/form-data; boundary=x" }, 415],
  ])("rejects %s upload before intake", async (label, overrides, status) => {
    // Given
    const headers = label === "anonymous" ? overrides : { ...harness.headers, ...overrides }
    // When
    const response = await fetch(`${harness.origin}/api/imports/upload`, {
      method: "POST",
      headers,
      body: zipFixture(epubEntries),
    })
    // Then
    expect(response.status).toBe(status)
  })
})
