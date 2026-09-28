import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prepareSourceDocument } from "@reading-studio/ingestion/source-document"
import { zipFixture } from "@reading-studio/ingestion/test-support"
import { afterEach, expect, it } from "vitest"
import { ContractBoundaryError, openStorage, type Storage } from "../src/index.ts"

const directories: string[] = []
const stores: Storage[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function fixture(text = "Hello 🌏 reader.", packageSuffix = "", inlinePages = true) {
  const directory = await mkdtemp(join(tmpdir(), "source-citations-"))
  directories.push(directory)
  const bytes = zipFixture([
    { name: "mimetype", text: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      text: '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    {
      name: "book.opf",
      text:
        '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c"/></spine></package>' +
        packageSuffix,
    },
    {
      name: "chapter.xhtml",
      text: `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><span id="page" ${inlinePages ? 'epub:type="pagebreak" title="iv"' : ""}/><p id="quote">${text}</p><p>Unanchored.</p></body></html>`,
    },
    {
      name: "nav.xhtml",
      text: '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="page-list"><a href="chapter.xhtml#page">iv</a></nav></body></html>',
    },
  ])
  const path = join(directory, "original.epub")
  await writeFile(path, bytes)
  const paths = {
    databasePath: join(directory, "db.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  const storage = openStorage(paths)
  stores.push(storage)
  await using file = await open(path, "r")
  const document = await prepareSourceDocument(file, { title: "Synthetic" })
  return { storage, document, paths, path, bytes }
}

function citation(document: Awaited<ReturnType<typeof prepareSourceDocument>>) {
  const resource = document.normalization.resources[0]
  if (resource?.status !== "included") throw new TypeError("missing chapter")
  const block = resource.blocks.find((item) => item.originalFragment === "quote")
  if (!block) throw new TypeError("missing quote")
  return {
    editionId: document.edition.id,
    normalizationRevisionId: document.normalization.id,
    resourcePath: resource.path,
    blockId: block.id,
    start: 6,
    end: 8,
    originalFragment: "quote",
    pageLabel: "iv",
  }
}

it("persists publisher page-list labels when inline labels are absent", async () => {
  // Given
  const { storage, document } = await fixture("Hello 🌏 reader.", "", false)
  storage.sources.persistDocument(document)
  // When
  const id = storage.sources.appendSpan(citation(document))
  // Then
  expect(storage.sources.resolveSpan(id)?.span.pageLabel).toBe("iv")
})

it("restores a persisted UTF-16 citation and provenance when SQLite is restarted", async () => {
  // Given
  const { storage, document, paths, bytes } = await fixture()
  storage.sources.persistDocument(document)
  const id = storage.sources.appendSpan(citation(document))
  storage.close()
  stores.splice(stores.indexOf(storage), 1)
  // When
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-transform-types",
      "--input-type=module",
      "--eval",
      `
    import { openStorage } from ${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)};
    const storage = openStorage(${JSON.stringify(paths)});
    try { console.log(JSON.stringify(storage.sources.resolveSpan(${JSON.stringify(id)}))); }
    finally { storage.close(); }
  `,
    ],
    { encoding: "utf8" },
  )
  const reopened = openStorage(paths)
  stores.push(reopened)
  const resolved = reopened.sources.resolveSpan(id)
  // Then
  expect(child.status, child.stderr).toBe(0)
  expect(JSON.parse(child.stdout)).toEqual({ span: citation(document), text: "🌏" })
  expect(resolved).toEqual({ span: citation(document), text: "🌏" })
  expect(reopened.sources.getEdition(document.edition.id)?.originalHash).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  )
  expect(reopened.sources.getNormalization(document.normalization.id)).toEqual(
    document.normalization,
  )
  expect(document.normalization.resources[0]).toMatchObject({
    blocks: [
      { text: "", originalFragment: "page", pageLabel: "iv" },
      { text: "Hello 🌏 reader." },
      { text: "Unanchored." },
    ],
  })
})

it("reuses identical source and span identities across restart and independent parsing", async () => {
  // Given
  const { storage, document, paths, path } = await fixture()
  storage.sources.persistDocument(document)
  const id = storage.sources.appendSpan(citation(document))
  storage.close()
  stores.splice(stores.indexOf(storage), 1)
  const reopened = openStorage(paths)
  stores.push(reopened)
  await using file = await open(path, "r")
  // When
  const repeated = await prepareSourceDocument(file, { title: "Synthetic" })
  reopened.sources.persistDocument(repeated)
  // Then
  expect(repeated).toEqual(document)
  expect(reopened.sources.appendSpan(citation(repeated))).toBe(id)
  expect(reopened.counts()).toMatchObject({ editions: 1, normalizations: 1, sourceBlocks: 3 })
})

it.each(["normalizerVersion", "parserVersion"] as const)(
  "separates sources when %s changes",
  async (version) => {
    // Given
    const { storage, document, path } = await fixture()
    storage.sources.persistDocument(document)
    await using file = await open(path, "r")
    // When
    const revised = await prepareSourceDocument(file, {
      title: "Synthetic",
      [version]: "revision-2",
    })
    storage.sources.persistDocument(revised)
    // Then
    expect(revised.edition.id).toBe(document.edition.id)
    expect(revised.normalization.id).not.toBe(document.normalization.id)
    expect(citation(revised).blockId).not.toBe(citation(document).blockId)
    expect(storage.counts()).toMatchObject({ editions: 1, normalizations: 2, sourceBlocks: 6 })
  },
)

it("separates changed original bytes and rejects mixed-edition citations", async () => {
  // Given
  const first = await fixture()
  const second = await fixture("Hello 🌏 reader.", "\n")
  first.storage.sources.persistDocument(first.document)
  first.storage.sources.persistDocument(second.document)
  // When / Then
  expect(second.document.edition.id).not.toBe(first.document.edition.id)
  expect(citation(second.document).blockId).not.toBe(citation(first.document).blockId)
  expect(() =>
    first.storage.sources.appendSpan({
      ...citation(first.document),
      editionId: second.document.edition.id,
    }),
  ).toThrow(ContractBoundaryError)
  expect(() =>
    first.storage.sources.appendSpan({
      ...citation(first.document),
      normalizationRevisionId: second.document.normalization.id,
    }),
  ).toThrow(ContractBoundaryError)
})

it.each([
  { start: -1 },
  { end: 1000 },
  { start: 8, end: 8 },
  { start: 9, end: 8 },
  { start: 0.5 },
  { originalFragment: "forged" },
  { pageLabel: "99" },
  { resourcePath: "missing.xhtml" },
])("rejects invalid citation %j before persistence", async (change) => {
  // Given
  const { storage, document } = await fixture()
  storage.sources.persistDocument(document)
  // When / Then
  expect(() => storage.sources.appendSpan({ ...citation(document), ...change })).toThrow(
    ContractBoundaryError,
  )
})

it("rolls back an edition when its normalization identity collides", async () => {
  // Given
  const first = await fixture()
  const second = await fixture("Changed edition.")
  first.storage.sources.persistDocument(first.document)
  const colliding = {
    ...second.document,
    normalization: { ...second.document.normalization, id: first.document.normalization.id },
  }
  // When / Then
  expect(() => first.storage.sources.persistDocument(colliding)).toThrow(ContractBoundaryError)
  expect(first.storage.sources.getEdition(second.document.edition.id)).toBeNull()
  expect(first.storage.sources.getNormalization(first.document.normalization.id)).toEqual(
    first.document.normalization,
  )
})

it("resolves an unanchored block using its resource locator", async () => {
  // Given
  const { storage, document } = await fixture()
  storage.sources.persistDocument(document)
  const resource = document.normalization.resources[0]
  if (resource?.status !== "included") throw new TypeError("missing chapter")
  const block = resource.blocks[2]
  if (!block) throw new TypeError("missing unanchored block")
  const span = {
    ...citation(document),
    blockId: block.id,
    originalFragment: resource.path,
    start: 0,
    end: block.text.length,
  }
  // When
  const id = storage.sources.appendSpan(span)
  // Then
  expect(storage.sources.resolveSpan(id)).toEqual({ span, text: "Unanchored." })
})
