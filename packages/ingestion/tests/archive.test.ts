import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm, stat, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type ArchiveLimits, acceptUpload, DEFAULT_ARCHIVE_LIMITS } from "../src/archive.ts"
import { encryptionFixture, epubEntries, zipFixture } from "./fixtures.ts"

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "archive-test-"))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function upload(bytes: Uint8Array, limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS) {
  return acceptUpload(new Blob([Uint8Array.from(bytes)]).stream(), {
    root,
    ownerId: "owner-test",
    limits,
  })
}

describe("bounded archive intake", () => {
  it("queues an original with its exact hash and private generated path when EPUB is safe", async () => {
    // Given
    const bytes = zipFixture(epubEntries)
    // When
    const result = await upload(bytes)
    // Then
    expect(result).toMatchObject({
      state: "queued",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      entries: 5,
    })
    const directory = join(root, result.id)
    expect(await readFile(join(directory, "original.epub"))).toEqual(bytes)
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
    expect((await stat(join(directory, "original.epub"))).mode & 0o777).toBe(0o600)
    expect(JSON.parse(await readFile(join(directory, "queued.json"), "utf8"))).toMatchObject({
      ...result,
      ownerId: "owner-test",
    })
    expect(await readdir(directory)).toEqual(["original.epub", "queued.json"])
  })

  it.each([
    "../escape",
    "/absolute",
    "C:/drive",
    "C:\\drive",
    "\\\\host\\file",
    "book/../../escape",
    "book\\..\\escape",
    "book/./chapter",
    "book//chapter",
    "book/%2e%2e/escape",
    "bad\u0000name",
  ])("rejects hostile entry %s without retaining files", async (name) => {
    // Given / When
    const result = upload(zipFixture([...epubEntries, { name, text: "hostile" }]))
    // Then
    await expect(result).rejects.toMatchObject({ code: "unsafe-path" })
    expect(await readdir(root)).toEqual([])
  })

  it.each([
    ["malformed", Buffer.from("not a zip"), "invalid-archive"],
    ["truncated", zipFixture(epubEntries).subarray(0, -12), "invalid-archive"],
    [
      "encrypted ZIP",
      zipFixture([...epubEntries, { name: "secret.xhtml", text: "secret", flags: 1 }]),
      "encrypted-content",
    ],
    [
      "local path mismatch",
      zipFixture([...epubEntries, { name: "safe", localName: "../x", text: "x" }]),
      "invalid-archive",
    ],
    ["duplicate", zipFixture([...epubEntries, epubEntries[2]]), "unsafe-path"],
    [
      "symlink",
      zipFixture([...epubEntries, { name: "link", text: "../outside", mode: 0o120777 }]),
      "unsafe-path",
    ],
    ["not EPUB", zipFixture([{ name: "plain.txt", text: "text" }]), "invalid-epub"],
    [
      "encrypted text",
      zipFixture([
        ...epubEntries,
        { name: "META-INF/encryption.xml", text: encryptionFixture("book/chapter.xhtml") },
      ]),
      "encrypted-content",
    ],
    [
      "font algorithm on text",
      zipFixture([
        ...epubEntries,
        {
          name: "META-INF/encryption.xml",
          text: encryptionFixture("book/chapter.xhtml", "http://www.idpf.org/2008/embedding"),
        },
      ]),
      "encrypted-content",
    ],
    [
      "external entity",
      zipFixture([
        ...epubEntries,
        {
          name: "META-INF/encryption.xml",
          text: '<!DOCTYPE encryption SYSTEM "http://127.0.0.1:1/private"><encryption/>',
        },
      ]),
      "invalid-encryption",
    ],
  ])("rejects %s", async (_label, bytes, code) => {
    // Given / When / Then
    await expect(upload(bytes)).rejects.toMatchObject({ code })
    expect(await readdir(root)).toEqual([])
  })

  it.each([
    ["compressed", { compressedBytes: 20 }],
    ["entry count", { entries: 2 }],
    ["per-entry", { entryBytes: 30 }],
    ["total expanded", { decompressedBytes: 80 }],
  ])("enforces the %s limit", async (_label, limits) => {
    // Given / When / Then
    await expect(
      upload(zipFixture(epubEntries), { ...DEFAULT_ARCHIVE_LIMITS, ...limits }),
    ).rejects.toMatchObject({ code: "limit-exceeded" })
    expect(await readdir(root)).toEqual([])
  })

  it("bounds actual inflation when headers lie about decompressed size", async () => {
    // Given
    const bytes = zipFixture([
      ...epubEntries,
      { name: "bomb.txt", text: "x".repeat(1_000_000), deflate: true, size: 1 },
    ])
    // When / Then
    await expect(
      upload(bytes, { ...DEFAULT_ARCHIVE_LIMITS, entryBytes: 1024 }),
    ).rejects.toMatchObject({ code: "limit-exceeded" })
    expect(await readdir(root)).toEqual([])
  })

  it.each(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"])(
    "allows font-only obfuscation using %s",
    async (algorithm) => {
      // Given
      const bytes = zipFixture([
        ...epubEntries,
        { name: "fonts/a.otf", text: "font" },
        { name: "META-INF/encryption.xml", text: encryptionFixture("fonts/a.otf", algorithm) },
      ])
      // When / Then
      expect((await upload(bytes)).state).toBe("queued")
    },
  )

  it("removes partial upload when its stream fails", async () => {
    // Given
    let chunks = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks++ === 0) controller.enqueue(new Uint8Array(32))
        else controller.error(new TypeError("disconnected"))
      },
    })
    // When / Then
    await expect(acceptUpload(body, { root, ownerId: "owner-test" })).rejects.toThrow(
      "disconnected",
    )
    expect(await readdir(root)).toEqual([])
  })

  it("rejects a directory masquerading as the EPUB container", async () => {
    // Given
    const bytes = zipFixture([
      epubEntries[0],
      { name: "META-INF/container.xml/", text: "", mode: 0o040700 },
    ])
    // When / Then
    await expect(upload(bytes)).rejects.toMatchObject({ code: "invalid-epub" })
  })

  it("accepts deflated content at exact byte and entry limits", async () => {
    // Given
    const entries = epubEntries.map((entry) => ({ ...entry, deflate: entry.name !== "mimetype" }))
    const bytes = zipFixture(entries)
    const sizes = entries.map((entry) => Buffer.byteLength(entry.text))
    // When
    const result = await upload(bytes, {
      compressedBytes: bytes.length,
      decompressedBytes: sizes.reduce((sum, size) => sum + size, 0),
      entryBytes: Math.max(...sizes),
      entries: entries.length,
    })
    // Then
    expect(result.entries).toBe(5)
  })

  it("rejects a symlink storage root", async () => {
    // Given
    const linked = join(root, "linked")
    await symlink(root, linked)
    // When / Then
    await expect(
      acceptUpload(new Blob([Uint8Array.from(zipFixture(epubEntries))]).stream(), {
        root: linked,
        ownerId: "owner-test",
      }),
    ).rejects.toMatchObject({ code: "unsafe-root" })
  })
})
