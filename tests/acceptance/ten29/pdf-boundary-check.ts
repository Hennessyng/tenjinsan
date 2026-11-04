import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { basename, isAbsolute, join } from "node:path"
import { z } from "zod"

const directory = z
  .string()
  .refine(isAbsolute)
  .refine((path) => /^ten29-pdf-provenance-[a-zA-Z0-9]+$/u.test(basename(path)))
  .parse(process.argv[2])
const text = (name: string) => readFile(join(directory, name), "utf8")
const json = async (name: string): Promise<unknown> => JSON.parse(await text(name))
const metadata = z.object({ sha256: z.string() }).parse(await json("metadata.json"))
assert.equal(
  createHash("sha256")
    .update(await readFile(join(directory, "mixed.pdf")))
    .digest("hex"),
  metadata.sha256,
)
const Item = z.union([
  z.object({ str: z.string(), hasEOL: z.boolean() }),
  z.object({ type: z.string() }),
])
const pages = z
  .array(z.object({ page: z.number(), items: z.array(Item) }))
  .parse(await json("pdfjs-items.json"))
const product = z
  .object({
    normalization: z.object({
      resources: z.array(z.object({ blocks: z.array(z.object({ text: z.string() })) })),
    }),
  })
  .parse(await json("product-extraction.json"))
assert.equal(pages.length, 4)
for (const [index, page] of pages.entries()) {
  const joined = page.items
    .flatMap((item) => ("str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : []))
    .join("")
    .trimEnd()
  assert.equal(joined, product.normalization.resources[index]?.blocks[0]?.text)
}
const page1 = await text("page-1-stream-1.txt")
const page2 = await text("page-2-stream-1.txt")
assert.match(page1, /\/ActualText <FEFF6587>/u)
assert.match(await text("font-5-ToUnicode.txt"), /<2F> <2F42>/u)
assert.match(page2, /\/ActualText <FEFF00650301>/u)
assert.match(await text("font-4-ToUnicode.txt"), /<0070> <00E9>/u)
const rawStrings = pages.flatMap((page) =>
  page.items.flatMap((item) => ("str" in item ? [item.str] : [])),
)
assert.ok(rawStrings.includes("⽂"))
assert.ok(rawStrings.includes("Caf"))
assert.ok(rawStrings.includes("é"))
const poppler = z
  .object({ stdout: z.string(), exit: z.literal(0) })
  .parse(await json("poppler.json"))
assert.ok(poppler.stdout.includes("本文"))
assert.ok(poppler.stdout.includes("Café"))
assert.ok(!poppler.stdout.includes("⽂"))
const summary = {
  sha256: metadata.sha256,
  pages: pages.length,
  productExactlyMatchesPdfjsItemsPlusItemSeparators: true,
  preservedActualText: {
    radicalGlyph: "U+2F42 -> ActualText U+6587",
    accentGlyph: "U+00E9 -> ActualText U+0065 U+0301",
  },
  popplerRecoversThoseOriginalScalars: true,
  wholePdfPopplerExactInventoryPass: "not established; line breaks and missing word spaces remain",
  strictProductGate: "FAIL; unchanged",
  semanticEvaluation: "NOT RUN",
}
await writeFile(join(directory, "boundary-check.json"), JSON.stringify(summary, null, 2), {
  mode: 0o600,
  flag: "wx",
})
console.info(JSON.stringify(summary))
