import { type BriefView, guidingQuestion, type StudySetupRevision } from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { html, raw } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"
import { briefDecisions, briefEditor } from "./forms.ts"

const styles = `
.brief textarea { display: block; width: 100%; padding: var(--space-3); font: inherit; color: var(--color-ink); background: var(--color-paper-raised); border: var(--rule) solid var(--color-green); }
.brief article { margin-block: var(--space-6); }
.brief [role="alert"] { border-left: var(--space-1) solid var(--color-focus); padding: var(--space-4); }
.brief dd { margin-inline-start: 0; white-space: pre-wrap; margin-bottom: var(--space-4); }
.brief dt { font-weight: 700; }
.brief h1 span { display: inline-block; }
.brief h2 { text-wrap: balance; }
`
const statuses = {
  pending: "brief.status.pending",
  approved: "brief.status.approved",
  revise: "brief.status.revise",
  defer: "brief.status.defer",
  outdated: "brief.status.outdated",
} as const

export function briefPage(input: {
  readonly view: BriefView | null
  readonly setup: StudySetupRevision
  readonly edit: boolean
  readonly error: boolean
  readonly locale?: UiLocale
  readonly descendants: readonly {
    readonly id: string
    readonly kind: string
    readonly status: string
  }[]
}) {
  const { view, setup } = input
  const locale = input.locale ?? "en"
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  const scope = view?.draft.scope ?? setup.analysis.scope
  const content = view?.draft.content
  const guiding = content ? guidingQuestion(content) : null
  return sourcePage(
    t("brief.title"),
    html`<style>${raw(styles)}</style><section class="setup brief">
    <p class="eyebrow">${t("brief.eyebrow")}</p><h1>${t("brief.title")}</h1>
    <p>${t("brief.intro")}</p>
    <nav><a href="/interviews/${setup.studyId}?step=~review&lang=${locale}">${t("brief.answers")}</a></nav>
    <p><a href="/revisions/${setup.studyId}?lang=${locale}">${t("brief.revisions")}</a></p>
    ${input.error ? html`<p role="alert" tabindex="-1" autofocus>${t("brief.saveError")}</p>` : html``}
    ${view ? html`<p role="status">${t(statuses[view.status])}</p><p class="metadata">${t("brief.revision")} <code>${view.draft.id}</code></p>` : html``}
    ${view?.status === "approved" ? html`<p><a href="/outlines/${setup.studyId}?lang=${locale}">${t("brief.outline")}</a></p>` : html``}
    <details open><summary>${t("brief.scope")}</summary>
    <p>${t(scope.kind === "partial" ? "brief.scope.partial" : scope.kind === "whole-document" ? "brief.scope.whole" : "brief.scope.main")}</p>
    <h2>${t("brief.included")}</h2><ul>${scope.selected.map((item) => html`<li>${item.resourcePath}<small>${item.blockIds.join(", ")}</small></li>`)}</ul>
    <h2>${t("brief.excluded")}</h2>${scope.exclusions.length ? html`<ul>${scope.exclusions.map((item) => html`<li>${item.resourcePath}<small>${item.blockIds.join(", ")}</small></li>`)}</ul>` : html`<p>${t("brief.none")}</p>`}
    <p>${t("brief.scope.note")}</p></details>
    ${
      !view || input.edit || view.status === "revise" || view.status === "outdated"
        ? briefEditor(view, locale)
        : content && guiding
          ? html`
      <article><h2>${t("brief.guiding")}</h2><p lang="en">${guiding.en}</p><p lang="ja">${guiding.ja}</p>
      <h2>${t("brief.supporting")}</h2>${content.supportingQuestions.length ? html`<ol>${content.supportingQuestions.map((question) => html`<li><p lang="en">${question.en}</p><p lang="ja">${question.ja}</p></li>`)}</ol>` : html`<p>${t("brief.none")}</p>`}</article>
      <h2>${t("brief.compare")}</h2>
      <dl><dt>${t("brief.original")}</dt><dd lang="en">${content.originalQuestion.en}</dd><dd lang="ja">${content.originalQuestion.ja}</dd>
      <dt>${t("brief.refined")}</dt><dd lang="en">${content.refinedQuestion?.en ?? t("brief.noAlternative")}</dd><dd lang="ja">${content.refinedQuestion?.ja ?? t("brief.noAlternative")}</dd></dl>
      <p>${t("brief.english")}: ${t(content.refinedQuestion && content.originalQuestion.en !== content.refinedQuestion.en ? "brief.changed" : "brief.unchanged")} · ${t("brief.japanese")}: ${t(content.refinedQuestion && content.originalQuestion.ja !== content.refinedQuestion.ja ? "brief.changed" : "brief.unchanged")}</p>
      <p>${t("brief.selected", { choice: t(content.questionChoice === "original" ? "brief.original" : "brief.refined") })}</p>
      <dl><dt>${t("brief.purpose")}</dt><dd>${content.purpose}</dd><dt>${t("brief.context")}</dt><dd>${content.context}</dd>
      <dt>${t("brief.depth")}</dt><dd>${{ overview: t("brief.depth.overview"), focused: t("brief.depth.focused"), deep: t("brief.depth.deep") }[content.depth]}</dd><dt>${t("brief.languages")}</dt><dd>${{ en: t("brief.english"), ja: t("brief.japanese"), paired: t("brief.paired") }[content.language]}</dd><dt>${t("brief.spoilers")}</dt><dd>${t(content.spoilerPolicy === "avoid" ? "brief.spoilers.avoid" : "brief.spoilers.allow")}</dd><dt>${t("brief.exclusions")}</dt><dd>${content.exclusions.join("\n") || t("brief.none")}</dd></dl>
       ${briefDecisions(view, locale)}`
          : html``
    }
    ${input.descendants.length ? html`<h2>${t("brief.descendants")}</h2><ul>${input.descendants.map((item) => html`<li>${item.kind}: ${item.id} — ${item.status}</li>`)}</ul>` : html``}
  </section>`,
    locale,
  )
}
