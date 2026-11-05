import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NormalizationRevision } from "@reading-studio/contracts"
import { prepareSourceDocument } from "@reading-studio/ingestion/source-document"
import { afterEach, expect, it } from "vitest"
import { epubEntries, zipFixture } from "../../packages/ingestion/tests/fixtures.ts"
import { auditCoverageInventory, createCoverageInventory } from "./ten29/coverage-inventory.ts"

const roots: string[] = []
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true })
})
async function syntheticSource() {
  const directory = await mkdtemp(join(tmpdir(), "coverage-inventory-"))
  roots.push(directory)
  const bytes = zipFixture(
    epubEntries.map((entry) =>
      entry.name === "book/chapter.xhtml"
        ? {
            ...entry,
            text: entry.text.replace(
              "</body>",
              '<p>A🧭é日本</p><p id="empty"></p><img src="local.png"/><object>Unavailable synthetic object</object></body>',
            ),
          }
        : entry,
    ),
  )
  const path = join(directory, "synthetic.epub")
  await writeFile(path, bytes)
  await using file = await open(path, "r")
  const prepared = await prepareSourceDocument(file, {
    title: "Synthetic range inventory",
    format: "epub",
  })
  return {
    ...prepared,
    spine: prepared.normalization.resources.map((resource) => ({
      path: resource.path,
      role: resource.role,
    })),
  }
}
it("inventories exact source identities, Unicode bytes/units and explicit omissions without copying text", async () => {
  const source = await syntheticSource(),
    inventory = createCoverageInventory(source)
  expect(auditCoverageInventory(source, inventory)).toEqual([])
  expect(inventory.source.sourceCoverage).toBe("partial")
  expect(inventory.omissions).toEqual(source.normalization.omissions)
  expect(inventory.totals.explicitOmissions).toBe(2)
  expect(inventory.primaryRanges.some((range) => range.utf8.end > range.utf16.end)).toBe(true)
  expect(
    inventory.primaryRanges.every(
      (range, index) => range.order === index && range.utf8.start === 0 && range.utf16.start === 0,
    ),
  ).toBe(true)
  for (const [index, range] of inventory.primaryRanges.entries()) {
    const resource = source.normalization.resources.find((row) => row.path === range.resourcePath),
      block =
        resource?.status === "included"
          ? resource.blocks.find((row) => row.id === range.blockId)
          : undefined
    if (!block) throw new TypeError("Missing synthetic source identity")
    expect(range.utf16.end).toBe(block.text.length)
    expect(range.utf8.end).toBe(Buffer.byteLength(block.text, "utf8"))
    expect(range.streamUtf16.start).toBe(
      index ? inventory.primaryRanges[index - 1]?.streamUtf16.end : 0,
    )
    expect(range.streamUtf8.start).toBe(
      index ? inventory.primaryRanges[index - 1]?.streamUtf8.end : 0,
    )
  }
  expect(auditCoverageInventory(source, { ...inventory, source: undefined })).toEqual([
    "inventory-shape",
  ])
  expect(inventory.overlapContext.ranges).toEqual([])
  expect(inventory.states).toMatchObject({
    dispatch: "NOT RUN",
    mapProcessing: "NOT RUN",
    synthesis: "NOT RUN",
    originalChecks: "NOT RUN",
    acceptedResults: "NONE",
  })
  expect(
    inventory.primaryRanges.every((range) => !("text" in range) && !("originalFragment" in range)),
  ).toBe(true)
})
it.each([
  "loss",
  "duplicate",
  "reorder",
  "changed-source",
  "byte-range",
  "omission-drop",
  "omission-duplicate",
  "omission-reorder",
  "pretend-processed",
] as const)("rejects synthetic manifest corruption %s", async (fault) => {
  const source = await syntheticSource(),
    inventory = createCoverageInventory(source),
    [first, ...rest] = inventory.primaryRanges
  if (!first) throw new TypeError("Missing synthetic primary range")
  let candidate: unknown = inventory,
    reference = source
  switch (fault) {
    case "loss":
      candidate = { ...inventory, primaryRanges: rest }
      break
    case "duplicate":
      candidate = { ...inventory, primaryRanges: [first, first, ...rest] }
      break
    case "reorder":
      candidate = { ...inventory, primaryRanges: [...inventory.primaryRanges].reverse() }
      break
    case "byte-range":
      candidate = {
        ...inventory,
        primaryRanges: [{ ...first, utf8: { start: 0, end: first.utf8.end + 1 } }, ...rest],
      }
      break
    case "changed-source":
      reference = {
        ...source,
        normalization: NormalizationRevision.parse({
          ...source.normalization,
          resources: source.normalization.resources.map((resource) =>
            resource.status === "included"
              ? {
                  ...resource,
                  blocks: resource.blocks.map((block, index) =>
                    index === 0 ? { ...block, text: block.text + " altered" } : block,
                  ),
                }
              : resource,
          ),
        }),
      }
      break
    case "omission-drop":
      candidate = { ...inventory, omissions: [] }
      break
    case "omission-duplicate":
      candidate = { ...inventory, omissions: [...inventory.omissions, ...inventory.omissions] }
      break
    case "omission-reorder":
      candidate = { ...inventory, omissions: [...inventory.omissions].reverse() }
      break
    case "pretend-processed":
      candidate = { ...inventory, states: { ...inventory.states, mapProcessing: "processed" } }
      break
    default: {
      const impossible: never = fault
      throw new TypeError(String(impossible))
    }
  }
  expect(auditCoverageInventory(reference, candidate).length).toBeGreaterThan(0)
})
