import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { chromium } from "@playwright/test"
import { z } from "zod"
import { prepareSourceDocument } from "../../../packages/ingestion/src/source-document.ts"
import { docxEntries } from "../../../packages/ingestion/tests/document-fixtures.ts"
import { epubEntries, zipFixture } from "../../../packages/ingestion/tests/fixtures.ts"
import originals from "./corpus.json"

export const corpus = z
  .array(
    z.object({
      id: z.string(),
      parts: z.array(z.object({ id: z.string(), text: z.string() })).length(4),
    }),
  )
  .parse(originals)
export type Family = (typeof corpus)[number]
export const formats = ["epub", "docx", "txt", "pdf"] as const
export type Format = (typeof formats)[number]
export const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export async function render(family: Family, format: Format): Promise<Uint8Array> {
  switch (format) {
    case "txt":
      return Buffer.from(family.parts.map((p) => p.text).join("\n"))
    case "epub":
      return zipFixture([
        ...epubEntries.filter((e) => e.name === "mimetype" || e.name === "META-INF/container.xml"),
        {
          name: "book/package.opf",
          text: `<package xmlns="http://www.idpf.org/2007/opf"><manifest>${family.parts.map((_, i) => `<item id="c${i}" href="${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${family.parts.map((_, i) => `<itemref idref="c${i}"${i === 3 ? ' linear="no"' : ""}/>`).join("")}</spine></package>`,
        },
        ...family.parts.map((p, i) => ({
          name: `book/${i + 1}.xhtml`,
          text: `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${escapeXml(p.text)}</p></body></html>`,
        })),
      ])
    case "docx": {
      const paragraph = (text: string) => `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
      return zipFixture([
        ...docxEntries.slice(0, 2),
        {
          name: "word/document.xml",
          text: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${family.parts
            .slice(0, 3)
            .map((p, i) =>
              family.id === "definitions" && i === 1
                ? `<w:tbl><w:tr><w:tc>${paragraph(p.text)}</w:tc></w:tr></w:tbl>`
                : paragraph(p.text),
            )
            .join("")}</w:body></w:document>`,
        },
        {
          name: "word/footnotes.xml",
          text: `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1">${paragraph(family.parts[3]?.text ?? "")}</w:footnote></w:footnotes>`,
        },
      ])
    }
    case "pdf": {
      const browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
        env: { HOME: homedir(), TMPDIR: tmpdir(), PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
        args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND"],
      })
      try {
        const context = await browser.newContext({
          offline: true,
          javaScriptEnabled: false,
          serviceWorkers: "block",
        })
        await context.route("**/*", (route) => route.abort())
        const page = await context.newPage()
        await page.setContent(
          `<style>@page{size:A4;margin:20mm}section{break-after:page;font:14px sans-serif;white-space:pre-wrap}section:last-child{break-after:auto}</style>${family.parts.map((p) => `<section>${escapeXml(p.text)}</section>`).join("")}`,
        )
        return await page.pdf({ preferCSSPageSize: true })
      } finally {
        await browser.close()
      }
    }
    default:
      throw new TypeError(`Unknown format ${format satisfies never}`)
  }
}

export async function extract(bytes: Uint8Array, format: Format) {
  const directory = await mkdtemp(join(tmpdir(), "ten29-"))
  try {
    const path = join(directory, `synthetic.${format}`)
    await writeFile(path, bytes, { mode: 0o600 })
    await using file = await open(path, "r")
    return await prepareSourceDocument(file, { title: "TEN29 synthetic", format })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
