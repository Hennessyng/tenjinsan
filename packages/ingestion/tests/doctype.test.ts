import { once } from "node:events"
import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { inspectEncryption } from "../src/encryption.ts"
import { normalizeEpub } from "../src/normalize.ts"
import { xml } from "../src/normalize-xml.ts"
import { epubEntries, zipFixture } from "./fixtures.ts"

async function normalize(declaration: string, target: string) {
  const directory = await mkdtemp(join(tmpdir(), "doctype-"))
  try {
    const path = join(directory, "fixture.epub")
    await writeFile(
      path,
      zipFixture(
        epubEntries.map((entry) => ({
          ...entry,
          text: entry.name === target ? declaration + entry.text : entry.text,
        })),
      ),
    )
    await using file = await open(path, "r")
    return await normalizeEpub(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it.each(["book/chapter.xhtml", "book/nav.xhtml"])(
  "preserves the full normalization when bare HTML DOCTYPE occurs in %s",
  async (target) => {
    // Given
    const expected = await normalize("", target)
    // When
    const actual = await normalize("<!DOCTYPE html>", target)
    // Then
    expect(actual).toEqual(expected)
  },
)

it.each(["META-INF/container.xml", "book/package.opf"])(
  "rejects bare HTML DOCTYPE when package metadata is %s",
  async (target) => {
    // Given / When / Then
    await expect(normalize("<!DOCTYPE html>", target)).rejects.toMatchObject({ code: "unsafe-xml" })
  },
)

it("rejects bare HTML DOCTYPE in EPUB2 NCX metadata", () => {
  // Given / When / Then
  expect(() =>
    xml(Buffer.from('<!DOCTYPE html><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"/>')),
  ).toThrow("unsafe-xml")
})

it("rejects bare HTML DOCTYPE in encryption metadata", () => {
  // Given / When / Then
  expect(() =>
    inspectEncryption(
      '<!DOCTYPE html><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>',
      new Set(),
    ),
  ).toThrow("invalid-encryption")
})

it("rejects unused external declarations without contacting a controlled resource", async () => {
  // Given: an actual loopback resource canary, not a fetch spy.
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.end("canary")
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new TypeError("Missing address")
  try {
    // When / Then
    for (const declaration of [
      `<!DOCTYPE html SYSTEM "http://127.0.0.1:${address.port}/unused.dtd">`,
      '<!DOCTYPE html [<!ENTITY unused SYSTEM "file:///TEN18-canary-never-read">]>',
      '<!DOCTYPE html PUBLIC "id" "unused.dtd">',
      "<!DOCTYPE html []>",
      "<!DOCTYPE HTML>",
    ])
      await expect(normalize(declaration, "book/chapter.xhtml")).rejects.toMatchObject({
        code: "unsafe-xml",
      })
    expect(requests).toBe(0)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

it("retains predefined and numeric entities when HTML declarations are allowed", async () => {
  // Given / When
  const node = xml(
    Buffer.from(
      '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml">&amp;&#65;&#x42;</html>',
    ),
    "xhtml",
  )
  // Then
  expect(node.children).toEqual(["&AB"])
})

it.each([
  "<html>&undefined;</html>",
  "<html><p></html>",
  "<html>" + "<p>".repeat(128) + "</p>".repeat(128) + "</html>",
  "<html>" + "<p/>".repeat(100_000) + "</html>",
])("fails closed for malformed or unbounded XML", (text) => {
  // Given / When / Then
  expect(() => xml(Buffer.from(text))).toThrow()
})
