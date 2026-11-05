import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { arch, platform, release } from "node:os"
import { join } from "node:path"
import { chromium } from "@playwright/test"
import { getDocument } from "@reading-studio/ingestion/pdf-test-support"
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib"
import { expect, it, vi } from "vitest"
import { z } from "zod"
import { corpus, extract, render } from "../acceptance/ten29/corpus-support.ts"
import { evidenceDirectory, repoPath } from "../acceptance/ten29/evidence.ts"

const require = createRequire(import.meta.url)
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
async function version(name: string) {
  const resolver =
    name === "playwright"
      ? createRequire(import.meta.resolve("@playwright/test"))
      : name === "pdfjs-dist"
        ? createRequire(new URL("../../packages/ingestion/package.json", import.meta.url))
        : require
  const json: unknown = JSON.parse(await readFile(resolver.resolve(`${name}/package.json`), "utf8"))
  return z.object({ version: z.string() }).parse(json).version
}
function localCommand(command: string, args: readonly string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 20000,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", LANG: "en_US.UTF-8" },
  })
  if (result.error) throw result.error
  expect(result.status).toBe(0)
  return { command, args, exit: result.status, stdout: result.stdout, stderr: result.stderr }
}

it("retains a synthetic failing PDF with mappings and independent local reader evidence", async () => {
  // Given
  const family = corpus.find((item) => item.id === "mixed")
  if (!family) throw new TypeError("Missing frozen mixed family")
  const directory = await evidenceDirectory("pdf-provenance")
  const save = (name: string, text: string | Uint8Array) =>
    writeFile(join(directory, name), text, { mode: 0o600, flag: "wx" })
  const bytes = await render(family, "pdf")
  const path = join(directory, "mixed.pdf")
  await save("mixed.pdf", bytes)
  const pdf = await PDFDocument.load(bytes)
  const sourceHashes: Record<string, string> = {}
  for (const source of [
    "tests/acceptance/ten29/corpus.json",
    "tests/acceptance/ten29/inventory.json",
    "tests/acceptance/ten29/corpus-support.ts",
    "packages/ingestion/src/pdf-process.mjs",
  ])
    sourceHashes[source] = digest(await readFile(repoPath(source)))
  const metadata = {
    syntheticOnly: true,
    family: family.id,
    sha256: digest(bytes),
    byteLength: bytes.length,
    node: process.version,
    executable: process.execPath,
    os: { platform: platform(), release: release(), arch: arch() },
    chromium: localCommand(chromium.executablePath(), ["--version"]),
    packages: {
      playwright: await version("playwright"),
      pdfjs: await version("pdfjs-dist"),
      pdfLib: await version("pdf-lib"),
    },
    fonts: localCommand("pdffonts", [path]),
    info: localCommand("pdfinfo", [path]),
    popplerVersion: localCommand("pdftotext", ["-v"]),
    renderer: {
      cssFont: "14px sans-serif",
      source: "tests/acceptance/ten29/corpus-support.ts:62-83",
      network: "offline context, request abort, DNS denial",
      embeddedFonts: "see fonts output and ToUnicode files",
      platformFontFiles: "not pinned or inventoried by batch1 renderer",
    },
    sourceHashes,
  }
  await save("metadata.json", JSON.stringify(metadata, null, 2))
  const mappings: {
    readonly fontObject: string
    readonly baseFont: string
    readonly cmap: string
  }[] = []
  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue
    const cmap = pdf.context.lookup(object.get(PDFName.of("ToUnicode")))
    if (!(cmap instanceof PDFRawStream)) continue
    const name = `font-${ref.objectNumber}-ToUnicode.txt`
    await save(name, decodePDFRawStream(cmap).decode())
    mappings.push({
      fontObject: ref.toString(),
      baseFont: object.get(PDFName.of("BaseFont"))?.toString() ?? "unknown",
      cmap: name,
    })
  }
  await save("mappings.json", JSON.stringify(mappings, null, 2))
  // When
  const extracted = await extract(bytes, "pdf")
  await save("product-extraction.json", JSON.stringify(extracted, null, 2))
  const poppler = localCommand("pdftotext", ["-enc", "UTF-8", "-raw", path, "-"])
  await save("poppler.json", JSON.stringify(poppler, null, 2))
  const task = getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    maxImageSize: 0,
    verbosity: 0,
  })
  vi.stubGlobal("fetch", () => {
    throw new TypeError("TEN29 diagnostic forbids network")
  })
  try {
    const document = await task.promise
    const pages = []
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const content = await page.getTextContent({ disableNormalization: true })
      pages.push({ page: number, items: content.items })
      page.cleanup()
    }
    await save("pdfjs-items.json", JSON.stringify(pages, null, 2))
  } finally {
    await task.destroy()
    vi.unstubAllGlobals()
  }
  // Then: preserve the strict mismatch rather than accepting transformed Unicode.
  const texts = extracted.normalization.resources.flatMap((r) =>
    r.status === "included" ? r.blocks.map((b) => b.text) : [],
  )
  expect(texts.map((text) => text.replace(/\s+/gu, " ").trim())).not.toEqual(
    family.parts.map((p) => p.text),
  )
  expect(mappings.length).toBeGreaterThan(0)
  expect(pdf.getPageCount()).toBe(4)
  console.info(
    JSON.stringify({
      evidence: directory,
      sha256: metadata.sha256,
      pages: pdf.getPageCount(),
      mappings: mappings.length,
    }),
  )
}, 30000)
