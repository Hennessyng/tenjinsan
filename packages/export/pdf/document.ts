import { readFile } from "node:fs/promises"
import type { AssetResolver } from "../html/assets.ts"
import { exportPrint } from "../print/index.ts"
import { PdfExportError, pdfLimits } from "./policy.ts"

export async function pdfDocument(input: unknown, resolveAsset?: AssetResolver): Promise<string> {
  const cssUrl = new URL(import.meta.resolve("@fontsource/noto-sans-jp/400.css"))
  const css = await readFile(cssUrl, "utf8")
  const urls = [...new Set([...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]))]
  let embedded = css
  for (const url of urls) {
    if (!url) throw new PdfExportError("font")
    const bytes = await readFile(new URL(url.replaceAll("'", "").replaceAll('"', ""), cssUrl))
    if (bytes.length > pdfLimits.assetBytes) throw new PdfExportError("limit")
    embedded = embedded.replaceAll(url, `"data:font/woff2;base64,${bytes.toString("base64")}"`)
  }
  const html = await exportPrint(
    input,
    resolveAsset &&
      (async (hash) => {
        const bytes = await resolveAsset(hash)
        if (bytes.byteLength > pdfLimits.assetBytes) throw new PdfExportError("limit")
        return bytes
      }),
  )
  return html.replace(
    "</head>",
    `<style>${embedded}
    @page { size: A4; margin: 16mm 15mm; }
    :root { background: white; --font-body: 'Noto Sans JP'; --font-display: 'Noto Sans JP'; --font-ja: 'Noto Sans JP'; }
    body, svg text { font-family: 'Noto Sans JP' !important; }
    body { padding: 0; background: white; color: #172f2a; font-size: 10pt; line-height: 1.65; }
    .print-document { width: 180mm; max-width: 100%; }
    h1 { font-size: 28pt; padding: 8mm 0; letter-spacing: 0; }
    h1 [lang=ja] { font-size: 18pt; margin-top: 3mm; }
    h2 { font-size: 22pt; margin-bottom: 5mm; }
    h3 { font-size: 15pt; } h4 { font-size: 11pt; }
    .chapter { padding: 0; margin: 0; background: white; }
    .chapter:first-of-type { break-before: auto; }
    .scene, .practice { margin-top: 6mm; }
    .pair { display: block; } .pair p + p { margin-top: 2mm; }
    .states { margin: 3mm 0; } .states > li { padding: 3mm 0; }
    h2, h3, h4 { break-after: avoid; }
    figure, .states > li, #print-questions li, #print-sources li { break-inside: avoid; }
    p { orphans: 3; widows: 3; }
    svg { max-height: 100mm; } img { max-height: 180mm; object-fit: contain; }
    * { animation: none !important; transition: none !important; print-color-adjust: exact; }
  </style></head>`,
  )
}
