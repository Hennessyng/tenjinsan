import type { BookEdition, NormalizationRevision, SourceSpan } from "@reading-studio/contracts"
import { html, raw } from "hono/html"
import type { HtmlEscapedString } from "hono/utils/html"
import { sourceViewerStyles } from "./styles.ts"

type Content = HtmlEscapedString | Promise<HtmlEscapedString>
export function sourcePage(title: string, content: Content, language: "en" | "ja" = "en") {
  return html`<!doctype html><html lang="${language}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Private normalized source reader with edition-specific citations.">
    <title>${title} | Reading Studio</title><style>${raw(sourceViewerStyles)}</style></head>
    <body><header><a href="/" lang="en">READING STUDIO</a><a href="/sources">${language === "en" ? "Your sources" : "資料一覧"}</a><a href="/interviews">${language === "en" ? "Reading interviews" : "読書の質問"}</a><a href="#reading">${language === "en" ? "Skip to reading" : "本文へ移動"}</a></header>
    <main id="reading">${content}</main><footer>${language === "en" ? "Private source reader · Text only · No external resources" : "非公開の資料 · テキストのみ · 外部への接続なし"}</footer></body></html>`
}

export function missingSource() {
  return sourcePage(
    "Missing reference",
    html`<h1>Missing reference</h1><p>This source, chapter or citation is unavailable in this edition and normalization.</p><p><a href="/sources">Return to your sources</a></p>`,
  )
}

export function sourceReader(input: {
  readonly edition: BookEdition
  readonly normalization: NormalizationRevision
  readonly chapter: number
  readonly span: SourceSpan | null
}) {
  const { edition, normalization, chapter, span } = input
  const resource = normalization.resources[chapter]
  const included = normalization.resources.filter((item) => item.status === "included")
  const exclusions = normalization.resources.filter((item) => item.status === "excluded")
  const base = `/sources/${normalization.id}`
  return sourcePage(
    edition.title,
    html`
    <p class="eyebrow">SOURCE / NORMALIZED TEXT</p><h1>${edition.title}</h1>
    <p><a href="${base}/setup">Set up a study</a></p>
    <p>Import status: normalized · <strong>${normalization.coverage === "complete" ? "Complete coverage" : "Partial coverage"}</strong> · ${included.length} of ${normalization.resources.length} resources included</p>
    <details><summary>Coverage and edition details</summary>
      <p>Original SHA-256: <code>${edition.originalHash}</code></p>
      <p>Revision: <code>${normalization.id}</code><br>Parser: ${normalization.parserVersion} · Normalizer: ${normalization.normalizerVersion}</p>
      <p>Publisher page labels belong to this edition, not other editions or screen pages.</p>
      ${exclusions.map((item) => html`<p>Excluded: ${item.path} — ${item.reason}</p>`)}
    </details>
    <div class="reader"><nav aria-label="Chapters"><h2>Contents</h2><ol>
      ${normalization.resources.map((item, index) => html`<li><a href="${base}?chapter=${index}" aria-current="${index === chapter ? "page" : "false"}">Chapter ${index + 1}</a><small>${item.path} · ${item.role}${item.status === "excluded" ? " · excluded" : ""}</small></li>`)}
    </ol></nav><article aria-labelledby="chapter-title">
      <h2 id="chapter-title" tabindex="-1" ${span === null ? html`autofocus` : html``}>Chapter ${chapter + 1}</h2>
      <p class="metadata">${resource?.path}</p>
      ${
        resource?.status === "included"
          ? resource.blocks.map(
              (block) => html`
        <p id="${block.id}" tabindex="-1" ${span?.blockId === block.id ? html`autofocus` : html``}>${
          span?.blockId === block.id
            ? html`${block.text.slice(0, span.start)}<mark>${block.text.slice(span.start, span.end)}</mark>${block.text.slice(span.end)}`
            : block.text
        }<small>${block.pageLabel === undefined ? "Page label unavailable" : `Page ${block.pageLabel}`}</small></p>`,
            )
          : html`<p>This resource was excluded: ${resource?.status === "excluded" ? resource.reason : "unavailable"}. No source text is available.</p>`
      }
    </article></div>`,
  )
}
