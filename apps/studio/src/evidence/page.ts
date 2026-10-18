import { type EvidenceView, projectedStrings } from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"
import { evidenceCategories, evidenceStatus } from "./copy.ts"

export {
  privateReaderDocument,
  privateReaderRuntime,
  readerDocument,
  sceneRuntime,
  spatialRuntime,
} from "@reading-studio/reader"
export { evidencePreview } from "./preview.ts"

export function evidencePage(
  view: EvidenceView,
  error: boolean,
  presentation: {
    readonly locale: UiLocale
    readonly references: readonly {
      readonly title: string
      readonly href: string
      readonly text: string
    }[]
  },
) {
  const { references, locale } = presentation
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  const { draft, privacy, mechanical } = view
  const expected = html`<input type="hidden" name="expectedId" value="${draft.id}">`
  return sourcePage(
    t("evidence.title"),
    html`
    <section class="setup evidence"><p class="eyebrow">${t("evidence.eyebrow")}</p>
    <h1>${t("evidence.title")}</h1>
    <nav><a href="/outlines/${draft.studyId}?lang=${locale}">${t("outline.title")}</a></nav>
    ${error ? html`<p role="alert" tabindex="-1" autofocus>${t("evidence.error")}</p>` : html``}
    <p role="status">${t(draft.keepPrivate ? "evidence.state.private" : view.ready ? "evidence.state.ready" : "evidence.state.review")}</p>
    <p class="metadata">${t("evidence.lesson")} ${draft.lessonRevisionId}<br>${t("evidence.projection")} ${draft.projectionHash}<br>${t("evidence.report")} ${view.reportHash}</p>
    <h2>${t("evidence.sourceTitle")}</h2>
    <p>${t(mechanical.length ? "evidence.sourceBroken" : "evidence.sourceMatched")}</p>
    <ul>${mechanical.map((flag) => html`<li role="alert">${flag.category}: <code>${flag.path}</code></li>`)}</ul>
    <details><summary>${t("evidence.compare")}</summary>${references.map((reference) => html`<p><a href="${reference.href}">${reference.title}</a></p><blockquote>${reference.text}</blockquote>`)}</details>
    <h2>${t("evidence.meaning")}</h2>
    <p>${t("evidence.meaningNote")}</p>
    ${draft.semantic.map(
      (
        decision,
      ) => html`<form method="post" aria-label="${t(evidenceCategories[decision.category])}">${expected}
      <input type="hidden" name="action" value="semantic"><input type="hidden" name="category" value="${decision.category}">
       <h3>${t(evidenceCategories[decision.category])}</h3><p>${t("evidence.state", { status: evidenceStatus(decision.status, t) })}</p><div class="setup-actions">
       <button name="status" value="reviewed">${t("evidence.markReviewed", { category: t(evidenceCategories[decision.category]) })}</button>
       <button name="status" value="acknowledged">${t("evidence.acknowledge", { category: t(evidenceCategories[decision.category]) })}</button></div></form>`,
    )}
    <h2>${t("evidence.privacy")}</h2>
    <p>${t("evidence.privacyNote", { count: privacy.reviewedPaths.length })}</p>
    <ul>${privacy.findings.map((finding) => html`<li role="alert">${finding.category}: <a href="#projected-content"><code>${finding.path}</code></a> — ${t("evidence.removeGeneralize")}</li>`)}</ul>
    <form method="post">${expected}<input type="hidden" name="action" value="private-detail">
      <label for="private-detail">${t("evidence.privateDetail")}</label><input id="private-detail" name="text" required><button>${t("evidence.screen")}</button></form>
    <form method="post">${expected}<div class="setup-actions"><button name="action" value="privacy-reviewed" ${privacy.findings.length ? html`disabled` : html``}>${t("evidence.confirmPrivacy")}</button>
      <button name="action" value="keep-private">${t("evidence.keepPrivate")}</button></div></form>
    <p>${t("evidence.privacyStatus", { status: evidenceStatus(privacy.status, t) })}</p>
    <h2 id="projected-content">${t("evidence.inspectTitle")}</h2>
    <a href="/evidence/${draft.studyId}/${draft.lessonRevisionId}/preview?lang=${locale}">${t("evidence.preview")}</a>
    <p><a href="/evidence/${draft.studyId}/${draft.lessonRevisionId}/read?lang=${locale}">${t("evidence.read")}</a></p>
    <p><a href="/publications/${draft.studyId}?lang=${locale}">${t("evidence.publication")}</a></p>
    <details><summary>${t("evidence.inspectAll")}</summary>
      ${projectedStrings(draft.projection).map(
        (
          entry,
          index,
        ) => html`<details><summary>${entry.path}</summary><p lang="${entry.path.endsWith("/ja") ? "ja" : "en"}">${entry.text}</p>
        <form method="post">${expected}<input type="hidden" name="action" value="replace-text"><input type="hidden" name="path" value="${entry.path}">
         <label for="value-${index}">${t("evidence.correct", { path: entry.path })}</label><textarea id="value-${index}" name="text" rows="3" required>${entry.text}</textarea><button>${t("evidence.saveCorrection")}</button></form>
         <form method="post">${expected}<input type="hidden" name="action" value="privacy-flag"><input type="hidden" name="path" value="${entry.path}"><button>${t("evidence.flagPrivate")}</button></form></details>`,
      )}
    </details>
    <details><summary>${t("evidence.removeUncertain")}</summary>
      ${draft.projection.sections.map((section, index) =>
        [
          `/sections/${index}`,
          ...section.scenes.map((_, i) => `/sections/${index}/scenes/${i}`),
          ...section.practice.map((_, i) => `/sections/${index}/practice/${i}`),
          ...section.sourceNotes.map((_, i) => `/sections/${index}/sourceNotes/${i}`),
        ].map(
          (path) =>
            html`<form method="post">${expected}<input type="hidden" name="action" value="remove-content"><input type="hidden" name="path" value="${path}"><button>${t("evidence.remove", { path })}</button></form>`,
        ),
      )}
    </details></section>`,
    locale,
  )
}
