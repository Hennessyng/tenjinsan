import type {
  AnalysisRevision,
  StudySetupRevision,
  TransmissionGrant,
} from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"
import { revisionScopeLabel } from "./copy.ts"

type RevisionView = {
  readonly setup: StudySetupRevision
  readonly history: readonly StudySetupRevision[]
  readonly parent: { readonly studyId: string; readonly setupRevisionId: string } | null
  readonly analysis: AnalysisRevision | null
  readonly grant: TransmissionGrant | null
}
type Presentation = {
  readonly available: boolean
  readonly canEdit: boolean
  readonly error: boolean
  readonly locale?: UiLocale
  readonly choices: readonly { readonly provider: string; readonly label: string }[]
}

export function revisionPage(view: RevisionView, presentation: Presentation) {
  const locale = presentation.locale ?? "en"
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  const { setup, parent, grant, analysis, history } = view
  const approved = grant?.kind === "active"
  const old = history.filter((revision) => revision.id !== setup.id)
  return sourcePage(
    t("revision.title"),
    html`
    <section class="setup evidence">
    <p class="eyebrow">${t("revision.eyebrow")}</p>
    <h1>${t(parent ? "revision.forkedTitle" : "revision.title")}</h1>
    <p>${t("revision.intro")}</p>
    ${presentation.error ? html`<p role="alert" tabindex="-1" autofocus>${t("revision.error")}</p>` : html``}
    ${parent ? html`<p><a href="/revisions/${parent.studyId}?lang=${locale}">${t("revision.original")}</a></p><p class="metadata">${t("revision.parent")} <code>${parent.setupRevisionId}</code></p>` : html``}
    <nav class="setup-actions" aria-label="${t("revision.workflow")}">
      ${presentation.canEdit ? html`<a href="/interviews/${setup.studyId}?lang=${locale}">${t("revision.editAnswers")}</a><a href="/briefs/${setup.studyId}?edit=1&lang=${locale}">${t("revision.editGoal")}</a>` : html``}
      <a href="/publications/${setup.studyId}?lang=${locale}">${t("revision.outputs")}</a>
    </nav>
    <h2>${t("revision.current")}</h2>
    <p>${setup.analysis.provider} · ${setup.analysis.model}</p>
    <p class="metadata">${t("jobs.meta.study")} <code>${setup.studyId}</code><br>${t("jobs.meta.setup")} <code>${setup.id}</code><br>${t("revision.edition")} <code>${setup.editionId}</code></p>
    <p>${t(analysis ? "revision.analysis.available" : "revision.analysis.required")}</p>
    <form method="post"><input type="hidden" name="expectedSetupRevisionId" value="${setup.id}">
      <button name="action" value="fork">${t("revision.fork")}</button>
      <p>${t("revision.fork.note")}</p>
    </form>
    <h2>${t("revision.provider.title")}</h2>
    <form method="post"><input type="hidden" name="action" value="provider"><input type="hidden" name="expectedSetupRevisionId" value="${setup.id}">
      <label for="provider">${t("revision.provider.label")}</label>
      <select id="provider" name="provider">${presentation.choices.map((choice) => html`<option value="${choice.provider}" ${choice.provider === setup.analysis.provider ? html`selected` : html``}>${choice.label}</option>`)}</select>
      <p>${t("revision.provider.note")}</p>
      <button>${t("revision.provider.review")}</button>
    </form>
    <h2>${t("revision.consent.title")}</h2>
    <p role="status">${t(approved ? "revision.consent.approved" : "revision.consent.required")}</p>
    <p>${t("revision.destination", { provider: setup.analysis.provider, model: setup.analysis.model })}</p>
    <details><summary>${t("revision.scope")}</summary>
      <p>${revisionScopeLabel(setup.analysis.scope.kind, t)}</p><ul>${setup.analysis.scope.selected.map((resource) => html`<li>${t("revision.blocks", { path: resource.resourcePath, count: resource.blockIds.length })}</li>`)}</ul>
      <p>${t("revision.excluded")} ${setup.analysis.scope.exclusions.map((resource) => resource.resourcePath).join(", ") || t("brief.none")}</p>
    </details>
    <p>${t("revision.charges")}</p>
    ${
      approved
        ? html``
        : html`<form method="post"><input type="hidden" name="expectedSetupRevisionId" value="${setup.id}">
      ${presentation.available ? html`` : html`<p>${t("revision.credentials")}</p>`}
      <button name="action" value="consent" ${presentation.available && !grant ? html`` : html`disabled`}>${t("revision.approve")}</button>
    </form>`
    }
    <h2>${t("revision.history")}</h2>
    ${old.length ? old.map((revision, index) => html`<section><h3>${t("revision.history.old", { n: old.length - index })}</h3><p>${revision.analysis.provider} · ${revision.analysis.model}</p><p class="metadata"><code>${revision.id}</code></p><p>${t("revision.history.retained")}</p></section>`) : html`<p>${t("revision.history.empty")}</p>`}
    <p>${t("revision.history.exports")}</p>
    </section>`,
    locale,
  )
}
