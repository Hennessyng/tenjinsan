import { createHash } from "node:crypto"
import { expect } from "vitest"
import { z } from "zod"
import { extract, type Family, type Format, render } from "./corpus-support.ts"
import inventoryData from "./inventory.json"
import { persistedSource, type SourcePolicy } from "./persisted-source.ts"

const inventory = z.record(z.string(), z.array(z.string()).length(4)).parse(inventoryData)
export async function persistedCorpus(family: Family, format: Format, policy: SourcePolicy = {}) {
  const bytes = await render(family, format)
  const extracted = await extract(bytes, format)
  const texts = extracted.normalization.resources.flatMap((r) =>
    r.status === "included" ? r.blocks.map((b) => b.text) : [],
  )
  const compact = (text: string) => text.replace(/\s+/gu, " ").trim()
  expect(
    format === "txt" ? texts.join("").split("\n") : format === "pdf" ? texts.map(compact) : texts,
  ).toEqual(format === "pdf" ? inventory[family.id]?.map(compact) : inventory[family.id])
  expect(extracted.normalization.coverage).toBe("complete")
  expect(extracted.normalization.omissions ?? []).toEqual([])
  expect(extracted.edition.originalHash).toBe(createHash("sha256").update(bytes).digest("hex"))
  if (format === "pdf")
    expect(extracted.normalization.resources.map((resource) => resource.path)).toEqual([
      "pdf/page-1",
      "pdf/page-2",
      "pdf/page-3",
      "pdf/page-4",
    ])
  return persistedSource(bytes, extracted, policy)
}
