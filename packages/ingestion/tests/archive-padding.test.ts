import { createHash } from "node:crypto"
import { mkdtemp, open, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { acceptUpload, DEFAULT_ARCHIVE_LIMITS } from "../src/archive.ts"
import { normalizeEpub } from "../src/normalize.ts"
import { prepareSourceDocument } from "../src/source-document.ts"
import { docxFixture, epubEntries, zipFixture } from "./fixtures.ts"

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "archive-padding-"))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})
const nul = (bytes: Buffer) => Buffer.concat([bytes, Buffer.from([0])])
const comment = (bytes: Buffer, text: string) => {
  const copy = Buffer.from(bytes)
  copy.writeUInt16LE(Buffer.byteLength(text), copy.length - 2)
  return Buffer.concat([copy, Buffer.from(text)])
}
const upload = (bytes: Buffer) =>
  acceptUpload(new Blob([Uint8Array.from(bytes)]).stream(), {
    root,
    ownerId: "synthetic-padding-owner",
  })
it("accepts exactly one NUL after a comment-free EPUB EOCD while preserving original bytes and identity", async () => {
  const bytes = nul(zipFixture(epubEntries)),
    result = await upload(bytes)
  expect(result).toMatchObject({
    bytes: bytes.length,
    entries: epubEntries.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  })
  expect(await readFile(join(root, result.id, "original.epub"))).toEqual(bytes)
  await using original = await open(join(root, result.id, "original.epub"), "r")
  const source = await prepareSourceDocument(original, {
    title: "Synthetic padded EPUB",
    format: "epub",
  })
  expect(source.edition.originalHash).toBe(result.sha256)
  expect(source.edition.originalBlobHash).toBe(result.sha256)
})
it("returns identical ordered normalized content for exact-EOF and narrowly padded EPUBs", async () => {
  const bytes = zipFixture(epubEntries),
    exact = await upload(bytes),
    padded = await upload(nul(bytes))
  await using a = await open(join(root, exact.id, "original.epub"), "r")
  await using b = await open(join(root, padded.id, "original.epub"), "r")
  expect(await normalizeEpub(b)).toEqual(await normalizeEpub(a))
  expect(exact.sha256).not.toBe(padded.sha256)
})
it.each([
  Buffer.from([0, 0]),
  Buffer.from([1]),
  Buffer.from([255]),
  Buffer.from(" "),
  Buffer.from("\n"),
  Buffer.from("%PDF-1.7\0"),
  Buffer.from("PK\x05\x06"),
  Buffer.alloc(65535),
])("rejects arbitrary, polyglot or overlong trailing bytes %#", async (suffix) => {
  await expect(upload(Buffer.concat([zipFixture(epubEntries), suffix]))).rejects.toMatchObject({
    code: "invalid-archive",
  })
  expect(await readdir(root)).toEqual([])
})
it("preserves legal ZIP comments, including a NUL within the declared comment", async () => {
  const result = await upload(comment(zipFixture(epubEntries), "comment\0"))
  expect(result.entries).toBe(epubEntries.length)
})
it("keeps the maximum ZIP comment boundary without allowing padding after it", async () => {
  const bytes = comment(zipFixture(epubEntries), "x".repeat(65535))
  expect((await upload(bytes)).entries).toBe(epubEntries.length)
  await expect(upload(nul(bytes))).rejects.toMatchObject({ code: "invalid-archive" })
})
it("does not apply the EPUB compatibility exception to DOCX", async () => {
  await expect(
    acceptUpload(new Blob([Uint8Array.from(nul(docxFixture()))]).stream(), {
      root,
      ownerId: "owner",
      format: "docx",
    }),
  ).rejects.toMatchObject({ code: "invalid-archive" })
})
it("charges the padded byte to the original compressed-byte limit", async () => {
  const bytes = zipFixture(epubEntries)
  await expect(
    acceptUpload(new Blob([Uint8Array.from(nul(bytes))]).stream(), {
      root,
      ownerId: "owner",
      limits: { ...DEFAULT_ARCHIVE_LIMITS, compressedBytes: bytes.length },
    }),
  ).rejects.toMatchObject({ code: "limit-exceeded" })
})
it.each([
  { name: "../escape", text: "x", code: "unsafe-path" },
  { name: "secret.xhtml", text: "x", flags: 1, code: "encrypted-content" },
  { name: "link", text: "outside", mode: 0o120777, code: "unsafe-path" },
  { name: "safe", localName: "../x", text: "x", code: "invalid-archive" },
])(
  "preserves path, encryption and local-record guards after NUL compatibility: $code",
  async ({ code, ...entry }) => {
    await expect(upload(nul(zipFixture([...epubEntries, entry])))).rejects.toMatchObject({ code })
    expect(await readdir(root)).toEqual([])
  },
)
it.each(["multidisk", "count", "directory", "zip64-offset", "overlap", "duplicate-end"] as const)(
  "rejects padded malformed metadata %s",
  async (mutation) => {
    const bytes = zipFixture(epubEntries),
      end = bytes.length - 22,
      central = bytes.readUInt32LE(end + 16)
    switch (mutation) {
      case "multidisk":
        bytes.writeUInt16LE(1, end + 4)
        break
      case "count":
        bytes.writeUInt16LE(1, end + 8)
        bytes.writeUInt16LE(1, end + 10)
        break
      case "directory":
        bytes.writeUInt32LE(bytes.readUInt32LE(end + 12) - 1, end + 12)
        break
      case "zip64-offset":
        bytes.writeUInt32LE(0xffffffff, end + 16)
        break
      case "overlap":
        bytes.writeUInt32LE(central, central + 20)
        break
      case "duplicate-end":
        break
      default: {
        const impossible: never = mutation
        throw new TypeError(String(impossible))
      }
    }
    const value =
      mutation === "duplicate-end"
        ? Buffer.concat([bytes, bytes.subarray(end), Buffer.from([0])])
        : nul(bytes)
    await expect(upload(value)).rejects.toMatchObject({ code: "invalid-archive" })
    expect(await readdir(root)).toEqual([])
  },
)
