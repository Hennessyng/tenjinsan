import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { acceptUpload } from "../src/archive.ts"
import { encryptionFixture, epubEntries, zipFixture } from "./fixtures.ts"

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "archive-malicious-"))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it.each([
  ["../escape", "safe.txt"],
  ["safe.txt", "../escape"],
])("rejects traversal in either raw or Unicode filename %s / %s", async (name, unicodeName) => {
  const bytes = zipFixture([...epubEntries, { name, unicodeName, flags: 0, text: "attack" }])
  await expect(
    acceptUpload(new Blob([Uint8Array.from(bytes)]).stream(), { root, ownerId: "owner" }),
  ).rejects.toMatchObject({ code: "unsafe-path" })
})

it.each([
  ["unknown font encryption", encryptionFixture("fonts/a.otf")],
  ["missing font", encryptionFixture("fonts/missing.otf", "http://www.idpf.org/2008/embedding")],
  ["malformed encryption", "<encryption>"],
  [
    "entity expansion",
    '<!DOCTYPE encryption [<!ENTITY a "expanded">]><encryption>&a;</encryption>',
  ],
  [
    "external target",
    encryptionFixture("https://attacker.example/font.otf", "http://www.idpf.org/2008/embedding"),
  ],
  [
    "encoded traversal",
    encryptionFixture("%2e%2e/outside.otf", "http://www.idpf.org/2008/embedding"),
  ],
])("rejects %s metadata without retaining an upload", async (_label, xml) => {
  // Given
  const bytes = zipFixture([
    ...epubEntries,
    { name: "fonts/a.otf", text: "font" },
    { name: "META-INF/encryption.xml", text: xml },
  ])
  // When / Then
  await expect(
    acceptUpload(new Blob([Uint8Array.from(bytes)]).stream(), { root, ownerId: "owner" }),
  ).rejects.toHaveProperty("code")
  expect(await readdir(root)).toEqual([])
})

it.each(["crc", "directory-length", "hidden-entries", "trailing-bytes"])(
  "rejects inconsistent ZIP %s",
  async (mutation) => {
    // Given
    const bytes = zipFixture(epubEntries)
    const end = bytes.length - 22
    switch (mutation) {
      case "crc":
        bytes[38] = 0
        break
      case "directory-length":
        bytes.writeUInt32LE(0xfffffff0, end + 12)
        break
      case "hidden-entries":
        bytes.writeUInt16LE(1, end + 8)
        bytes.writeUInt16LE(1, end + 10)
        break
      case "trailing-bytes":
        bytes.writeUInt16LE(1, end + 20)
        break
    }
    // When / Then
    await expect(
      acceptUpload(new Blob([Uint8Array.from(bytes)]).stream(), { root, ownerId: "owner" }),
    ).rejects.toMatchObject({ code: "invalid-archive" })
    expect(await readdir(root)).toEqual([])
  },
)

it("rejects more than 5000 real ZIP entries at default limits", async () => {
  // Given
  const bytes = zipFixture(
    Array.from({ length: 5001 }, (_, index) => ({ name: `entry-${index}`, text: "" })),
  )
  // When / Then
  await expect(
    acceptUpload(new Blob([Uint8Array.from(bytes)]).stream(), { root, ownerId: "owner" }),
  ).rejects.toMatchObject({ code: "limit-exceeded" })
})

it("cancels the producer as soon as compressed bytes exceed the limit", async () => {
  // Given
  let cancelled = false
  let pulls = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++
      controller.enqueue(new Uint8Array(11))
    },
    cancel() {
      cancelled = true
    },
  })
  // When / Then
  await expect(
    acceptUpload(body, {
      root,
      ownerId: "owner",
      limits: { compressedBytes: 10, decompressedBytes: 100, entryBytes: 100, entries: 10 },
    }),
  ).rejects.toMatchObject({ code: "limit-exceeded" })
  expect(cancelled).toBe(true)
  expect(pulls).toBeLessThanOrEqual(2)
  expect(await readdir(root)).toEqual([])
})
