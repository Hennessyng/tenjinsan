import type { BookEdition, NormalizationRevision, SourceSpan } from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { html, raw } from "hono/html"
import type { HtmlEscapedString } from "hono/utils/html"
import { sourceLocation } from "./source-location.ts"
import { sourceViewerStyles } from "./styles.ts"

export { sourceLocation } from "./source-location.ts"

type Content = HtmlEscapedString | Promise<HtmlEscapedString>
export function sourcePage(title: string, content: Content, language: UiLocale = "en") {
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key)
  return html`<!doctype html><html lang="${language}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${t("source.frame.footer")}">
    <title>${title} | ${t("startup.title")}</title><style>${raw(sourceViewerStyles)}</style></head>
    <body><header><a href="/" lang="en">READING STUDIO</a><a href="/sources?lang=${language}">${t("source.frame.sources")}</a><a href="/interviews?lang=${language}">${t("source.frame.interviews")}</a><a href="#reading">${t("source.frame.skip")}</a></header>
    <main id="reading">${content}</main><footer>${t("source.frame.footer")}</footer></body></html>`
}

export function missingSource(locale: UiLocale = "en") {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key)
  return sourcePage(
    t("source.missing.title"),
    html`<h1>${t("source.missing.title")}</h1><p>${t("source.missing.body")}</p><p><a href="/sources?lang=${locale}">${t("source.missing.back")}</a></p>`,
    locale,
  )
}

export function sourceReader(input: {
  readonly edition: BookEdition
  readonly normalization: NormalizationRevision
  readonly chapter: number
  readonly span: SourceSpan | null
  readonly locale?: UiLocale
}) {
  const locale = input.locale ?? "en"
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  const { edition, normalization, chapter, span } = input
  const resource = normalization.resources[chapter]
  const included = normalization.resources.filter((item) => item.status === "included")
  const exclusions = normalization.resources.filter((item) => item.status === "excluded")
  const base = `/sources/${normalization.id}`
  return sourcePage(
    edition.title,
    html`
     <p class="eyebrow">${t("source.reader.eyebrow")}</p><h1>${edition.title}</h1>
     <p><a href="${base}/setup?lang=${locale}">${t("source.reader.setup")}</a></p>
     <p>${t("source.reader.status", { coverage: t(normalization.coverage === "complete" ? "source.coverage.complete" : "source.coverage.partial"), included: included.length, total: normalization.resources.length })}</p>
     <details><summary>${t("source.details.summary")}</summary>
       <p>${t("source.details.hash")} <code>${edition.originalHash}</code></p>
       <p>${t("source.details.revision")} <code>${normalization.id}</code><br>${t("source.details.parser", { parser: normalization.parserVersion, normalizer: normalization.normalizerVersion })}</p>
       <p>${t("source.details.note")}</p>
        ${(normalization.omissions ?? exclusions).map((item) => html`<p>${t("source.details.omitted", { path: item.path, reason: item.reason })}</p>`)}
    </details>
     <div class="reader"><nav aria-label="${t("source.reader.chapters")}"><h2>${t("source.reader.contents")}</h2><ol>
       ${normalization.resources.map((item, index) => html`<li><a href="${base}?chapter=${index}&lang=${locale}" aria-current="${index === chapter ? "page" : "false"}">${t("source.reader.chapter", { n: index + 1 })}</a><small>${item.path} · ${item.role}${item.status === "excluded" ? ` · ${t("source.reader.excludedSuffix")}` : ""}</small></li>`)}
    </ol></nav><article aria-labelledby="chapter-title">
       <h2 id="chapter-title" tabindex="-1" ${span === null ? html`autofocus` : html``}>${t("source.reader.chapter", { n: chapter + 1 })}</h2>
      <p class="metadata">${resource?.path}</p>
      ${
        resource?.status === "included"
          ? resource.blocks.map(
              (block) => html`
        <p id="${block.id}" tabindex="-1" ${span?.blockId === block.id ? html`autofocus` : html``}>${
          span?.blockId === block.id
            ? html`${block.text.slice(0, span.start)}<mark>${block.text.slice(span.start, span.end)}</mark>${block.text.slice(span.end)}`
            : block.text
        }<small>${sourceLocation(block, t)}</small></p>`,
            )
          : html`<p>${t("source.reader.resourceExcluded", { reason: resource?.status === "excluded" ? resource.reason : t("source.reader.reasonUnavailable") })}</p>`
      }
     </article></div>`,
    locale,
  )
}
