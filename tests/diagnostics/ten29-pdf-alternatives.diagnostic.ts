import { spawnSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getDocument } from "@reading-studio/ingestion/pdf-test-support"
import { expect, it } from "vitest"
import { corpus, render } from "../acceptance/ten29/corpus-support.ts"
import { evidenceDirectory } from "../acceptance/ten29/evidence.ts"

it("records strict frozen comparisons for bounded public-reader alternatives, not acceptance", async () => {
  const directory = await evidenceDirectory("pdf-alternatives")
  const compact = (text: string) => text.replace(/\s+/gu, " ").trim()
  const results = []
  for (const family of corpus) {
    const bytes = await render(family, "pdf")
    const path = join(directory, `${family.id}.pdf`)
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" })
    const task = getDocument({
      data: new Uint8Array(bytes),
      useWorkerFetch: false,
      disableFontFace: true,
      useSystemFonts: false,
      stopAtErrors: true,
      maxImageSize: 0,
      verbosity: 0,
    })
    try {
      const document = await task.promise
      for (const [index, part] of family.parts.entries()) {
        const page = await document.getPage(index + 1)
        for (const disableNormalization of [true, false]) {
          const content = await page.getTextContent({
            disableNormalization,
            includeMarkedContent: true,
          })
          const actual = compact(
            content.items
              .flatMap((item) => ("str" in item ? [item.str + (item.hasEOL ? "\n" : "")] : []))
              .join(""),
          )
          results.push({
            family: family.id,
            part: part.id,
            reader: disableNormalization
              ? "pdfjs-raw-concat"
              : "pdfjs-normalized-concat-DIAGNOSTIC-ONLY",
            exact: actual === part.text,
            actual,
            expected: part.text,
          })
        }
        for (const [mode, args] of [
          ["raw", ["-raw"]],
          ["layout", ["-layout"]],
          ["default", []],
        ] as const) {
          const output = spawnSync(
            "pdftotext",
            [
              "-f",
              String(index + 1),
              "-l",
              String(index + 1),
              "-enc",
              "UTF-8",
              "-nopgbrk",
              ...args,
              path,
              "-",
            ],
            { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 },
          )
          expect(output.status).toBe(0)
          const actual = compact(output.stdout)
          results.push({
            family: family.id,
            part: part.id,
            reader: `poppler-${mode}`,
            exact: actual === part.text,
            actual,
            expected: part.text,
          })
        }
      }
    } finally {
      await task.destroy()
    }
  }
  await writeFile(
    join(directory, "alternatives.json"),
    JSON.stringify(
      {
        meaning:
          "exact text only under original whitespace policy; not semantic score or approved backend",
        results,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  )
  console.info(`PDF_ALTERNATIVES_EVIDENCE=${directory}`)
})
