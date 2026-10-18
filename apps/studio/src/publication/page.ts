import {
  type EvidenceView,
  type PublicationOutput,
  type PublicationSnapshot,
  projectedStrings,
} from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"
import { exportInterfaceLabel, pendingOutputLabel } from "./copy.ts"

export type PublicationHistory = {
  readonly snapshot: PublicationSnapshot
  readonly current: boolean
  readonly outputs: readonly PublicationOutput[]
}

export function publicationPage(
  view: EvidenceView | null,
  history: readonly PublicationHistory[],
  locale: UiLocale = "en",
) {
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  const approved = history.find((entry) => entry.current)
  const exportUi = approved?.snapshot.exportUi ?? approved?.outputs[0]?.exportUi ?? "en"
  const studyId = view?.draft.studyId ?? history[0]?.snapshot.evidence.draft.studyId
  const status = view?.draft.keepPrivate
    ? t("publication.state.private")
    : approved?.outputs.some((output) => output.state === "failed")
      ? t("publication.state.failed")
      : approved?.outputs.every((output) => output.state === "released")
        ? t("publication.state.ready")
        : approved
          ? t("publication.state.pending")
          : view?.ready
            ? t("publication.state.approval")
            : t("publication.state.review")
  return sourcePage(
    t("publication.title"),
    html`
    <section class="setup evidence"><p class="eyebrow">${t("publication.eyebrow")}</p>
    <h1>${t("publication.title")}</h1>
    <p>${t("publication.intro")}</p>
    <p role="status">${status}</p>
    ${studyId ? html`<p><a href="/revisions/${studyId}?lang=${locale}">${t("revision.title")}</a></p>` : html``}
    ${
      view
        ? html`
       <nav><a href="/evidence/${view.draft.studyId}/${view.draft.lessonRevisionId}?lang=${locale}">${t("evidence.title")}</a></nav>
       <h2>${t("publication.cleaned")}</h2>
      <h3>${view.draft.projection.title.en} / <span lang="ja">${view.draft.projection.title.ja}</span></h3>
      ${view.draft.projection.sections.map((section) => html`<section><h3>${section.heading.en} / <span lang="ja">${section.heading.ja}</span></h3><p lang="en">${section.content.en}</p><p lang="ja">${section.content.ja}</p></section>`)}
       <details><summary>${t("publication.inspect")}</summary>
      ${projectedStrings(view.draft.projection).map((entry) => html`<p><code>${entry.path}</code></p><p lang="${entry.path.endsWith("/ja") ? "ja" : "en"}">${entry.text}</p>`)}</details>
       <p class="metadata">${t("publication.content")} ${view.draft.projectionHash}<br>${t("publication.evidence")} ${view.reportHash}<br>${t("publication.privacy")} ${view.privacy.id}</p>
      <form method="post"><input type="hidden" name="expectedId" value="${view.draft.id}">
       <label for="export-ui">${t("publication.exportUi")}</label><select id="export-ui" name="exportUi" ${approved ? html`disabled` : html``}><option value="en" ${exportUi === "en" ? html`selected` : html``}>${t("publication.exportUi.en")}</option><option value="ja" ${exportUi === "ja" ? html`selected` : html``}>${t("publication.exportUi.ja")}</option><option value="en+ja" ${exportUi === "en+ja" ? html`selected` : html``}>${t("publication.exportUi.paired")}</option></select><p>${t("publication.exportUi.note")}</p>
       <div class="setup-actions"><button name="action" value="publish" ${view.ready && !approved ? html`` : html`disabled`}>${t("publication.publish")}</button>
       <button name="action" value="revise">${t("brief.revise")}</button>
       <button name="action" value="keep-private">${t("evidence.keepPrivate")}</button></div></form>
       <p>${t("publication.note")}</p>`
        : html``
    }
    <h2>${t("publication.history")}</h2>
    <p>${t("publication.history.retry")}</p>
    ${
      history.length
        ? history.map(
            ({ snapshot, current, outputs }, index) => html`
       <section><h3>${t("publication.version", { n: history.length - index })} · ${t(current ? "publication.currentApproval" : "publication.stale")}</h3>
       <p class="metadata">${snapshot.publication.id}<br>${snapshot.publication.approval.rendererVersion}<br>${snapshot.publication.approval.approvedAt}</p>
       <p class="metadata">${t("publication.history.ui", { language: exportInterfaceLabel(snapshot.exportUi ?? outputs[0]?.exportUi, t) })}</p>
      <ul>${outputs.map(
        (
          output,
        ) => html`<li>${output.format.toUpperCase()} — ${output.state === "released" ? t(current ? "publication.current" : "publication.old") : output.state === "failed" ? t("publication.outputError", { error: output.error }) : t("publication.notAvailable", { state: pendingOutputLabel(output.state, t) })}
       ${output.state === "released" ? html`<a href="/publication-artifacts/${output.id}">${t("publication.download", { format: output.format.toUpperCase(), n: history.length - index })}</a>` : html``}</li>`,
      )}</ul>
       ${current && outputs.some((output) => output.state === "queued") ? html`<form method="post" action="/publications/${snapshot.evidence.draft.studyId}/outputs/${snapshot.publication.id}?lang=${locale}"><button>${t("publication.generate")}</button></form>` : html``}
      </section>`,
          )
        : html`<p>${t("publication.empty")}</p>`
    }
    </section>`,
    locale,
  )
}
