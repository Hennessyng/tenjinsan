import type { NormalizationRevision, StudySetupRevision } from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import { wholeBookScope } from "@reading-studio/contracts/source-scope"
import { LocalSubscriptionProvider } from "@reading-studio/contracts/subscriptions"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"

export function setupChoices(input: {
  readonly normalization: NormalizationRevision
  readonly locale?: UiLocale
  readonly choices: readonly {
    readonly provider: string
    readonly model: string
    readonly label: string
  }[]
}) {
  const { normalization, choices } = input
  const locale = input.locale ?? "en"
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  const extracted = wholeBookScope(normalization) !== null
  return sourcePage(
    t("setup.title"),
    html`
     <section class="setup"><p class="eyebrow">${t("setup.eyebrow")}</p><h1>${t("setup.title")}</h1>
     <p>${t("setup.intro")}</p>
     <p><a href="/sources/${normalization.id}?lang=${locale}">${t("setup.sourcePreview")}</a></p>
     <form method="post" action="/sources/${normalization.id}/setup?lang=${locale}">
       <label for="provider">${t("revision.provider.label")}</label><select id="provider" name="provider">${choices.map((choice) => html`<option value="${choice.provider}">${choice.label}</option>`)}</select>
       <section aria-labelledby="coverage-heading"><h2 id="coverage-heading">${t("setup.review.selected")}</h2>
         ${extracted ? html`<p>${t("setup.coverage.whole")}</p><ul data-included>${normalization.resources.map((resource) => (resource.status === "included" ? html`<li>${t("revision.blocks", { path: resource.path, count: resource.blocks.length })}</li>` : html``))}</ul>` : html`<p role="status">${t("setup.coverage.empty")}</p>`}
         ${normalization.resources.some((resource) => resource.status === "excluded") ? html`<p>${t("setup.coverage.omitted")}</p><ul data-omitted>${normalization.resources.map((resource) => (resource.status === "excluded" ? html`<li>${t("setup.resourceUnavailable", { path: resource.path, reason: resource.reason })}</li>` : html``))}</ul>` : html``}
       </section><p>${t("setup.apiNote")}</p>
       <button type="submit" ${extracted ? html`` : html`disabled`}>${t("setup.review")}</button>
    </form></section>`,
    locale,
  )
}

export function setupReview(input: {
  readonly setup: StudySetupRevision
  readonly normalization: NormalizationRevision
  readonly available: boolean
  readonly locale?: UiLocale
}) {
  const { setup, available } = input
  const locale = input.locale ?? "en"
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  return sourcePage(
    t("setup.review"),
    html`
     <section class="setup"><p class="eyebrow">${t("setup.review.eyebrow")}</p><h1>${t("setup.review")}</h1>
    <h2>${setup.analysis.provider} / ${setup.analysis.model}</h2>
     <p>${t("setup.review.scope", { scope: t(setup.analysis.scope.kind === "whole-document" ? "brief.scope.whole" : setup.analysis.scope.kind === "partial" ? "brief.scope.partial" : "brief.scope.main") })}</p>
      <h2>${t("setup.review.extraction")}</h2>
      <p>${t("setup.review.coverage", { coverage: t(input.normalization.coverage === "complete" ? "source.coverage.complete" : "source.coverage.partial") })}</p>
      <ul>${input.normalization.omissions?.map((item) => html`<li>${item.path} · ${item.reason}</li>`)}</ul>
      <p>${t("setup.review.original")}</p><p>${t("setup.review.windows")}</p>
      <h2>${t("setup.review.selected")}</h2><ul data-selected>${setup.analysis.scope.selected.map((resource) => html`<li>${t("revision.blocks", { path: resource.resourcePath, count: resource.blockIds.length })}</li>`)}</ul>
     <h2>${t("setup.review.excluded")}</h2><ul data-excluded>${input.normalization.resources.filter((resource) => !setup.analysis.scope.selected.some((selection) => selection.resourcePath === resource.path)).map((resource) => html`<li>${resource.path}${resource.status === "excluded" ? ` · ${t("setup.review.unavailable", { reason: resource.reason })}` : ""}</li>`)}</ul>
      ${LocalSubscriptionProvider.safeParse(setup.analysis.provider).success ? html`<section aria-label="${t("subscription.executionTitle")}"><h3>${t("subscription.executionTitle")}</h3><p>${t("subscription.requestScope")}</p><p>${t("subscription.executionLimits")}</p><p>${t("subscription.executionTrust")}</p><p>${t("subscription.identityBinding")}</p></section>` : html`<p>${t("setup.review.limits")}</p>`}
     <p>${t("setup.review.timeouts")}</p>
     ${available ? html`<p>${t("setup.review.available")}</p>` : html`<p role="status">${t("setup.review.providerUnavailable")}</p>`}
     <form method="post" action="/sources/${setup.analysis.normalizationRevisionId}/setup/${setup.id}?lang=${locale}"><div class="setup-actions">
       <button name="decision" value="send" ${available ? html`` : html`disabled`}>${t("setup.send")}</button>
       <button name="decision" value="revise">${t("brief.revise")}</button><button name="decision" value="cancel">${t("setup.cancel")}</button>
     </div></form><p><small>${t("setup.revision", { id: setup.id })}</small></p></section>`,
    locale,
  )
}

export function setupResult(input: {
  readonly title: string
  readonly message: string
  readonly revision: string
  readonly grantId?: string
  readonly progressUrl?: string
  readonly locale?: UiLocale
}) {
  const locale = input.locale ?? "en"
  return sourcePage(
    input.title,
    html`<section class="setup"><h1>${input.title}</h1><p>${input.message}</p>${input.grantId ? html`<p data-grant="${input.grantId}">${translate(locale, "setup.consentSaved")}</p><p><a href="${input.progressUrl ?? `/jobs?lang=${locale}`}">${translate(locale, "setup.viewProgress")}</a></p>` : html``}<p><a href="/sources/${input.revision}/setup?lang=${locale}">${translate(locale, "setup.back")}</a></p></section>`,
    locale,
  )
}
