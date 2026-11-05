import type { NormalizationRevision, StudySetupRevision } from "@reading-studio/contracts"
import { translate, type UiLocale } from "@reading-studio/contracts/i18n"
import {
  type PreparationReview,
  preparationAllowanceParams,
  preparationReasonKey,
} from "@reading-studio/contracts/setup-progress"
import { wholeBookScope } from "@reading-studio/contracts/source-scope"
import {
  LOCAL_CHATGPT_INFERENCE_POLICY,
  LocalSubscriptionProvider,
} from "@reading-studio/contracts/subscriptions"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"
import { batchedMarkup } from "./batched-markup.ts"
import { sendBlockedKey } from "./send-blocked.ts"

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
  readonly deployment?: "local" | "hosted"
  readonly preparation?: PreparationReview
  readonly reviewUrl?: string
  readonly studyQuery?: string
  readonly locale?: UiLocale
}) {
  const { setup, available } = input
  const versioned = input.preparation !== undefined || setup.analysis.processing !== undefined
  const blockedKey = sendBlockedKey({
    current:
      !versioned ||
      (input.deployment === "local" &&
        setup.analysis.provider === "chatgpt-subscription" &&
        setup.analysis.processing?.inferencePolicyVersion === LOCAL_CHATGPT_INFERENCE_POLICY),
    available,
    preparation: input.preparation,
  })
  const effectiveBlockedKey = versioned
    ? blockedKey
    : available
      ? null
      : "setup.review.providerUnavailable"
  const current =
    !versioned ||
    (input.deployment === "local" &&
      setup.analysis.provider === "chatgpt-subscription" &&
      setup.analysis.processing?.inferencePolicyVersion === LOCAL_CHATGPT_INFERENCE_POLICY)
  const locale = input.locale ?? "en"
  const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
    translate(locale, key, params)
  return sourcePage(
    t("setup.review"),
    html`
      <section class="setup"><p class="eyebrow">${t("setup.review.eyebrow")}</p><h1>${t("setup.review")}</h1>
        ${input.preparation?.purpose ? html`<p role="status">${t("setup.analysisOnlyPurpose")}</p>` : html``}
     <h2>${setup.analysis.provider} / ${setup.analysis.model}</h2>
     ${!current ? html`<p role="status">${t("setup.exclusive.history")} <a href="${input.reviewUrl ?? `/sources/${setup.analysis.normalizationRevisionId}/setup`}">${t("setup.exclusive.rereview")}</a></p>` : html``}
     <p>${t("setup.review.scope", { scope: t(setup.analysis.scope.kind === "whole-document" ? "brief.scope.whole" : setup.analysis.scope.kind === "partial" ? "brief.scope.partial" : "brief.scope.main") })}</p>
      <h2>${t("setup.review.extraction")}</h2>
      <p>${t("setup.review.coverage", { coverage: t(input.normalization.coverage === "complete" ? "source.coverage.complete" : "source.coverage.partial") })}</p>
      <ul>${input.normalization.omissions?.map((item) => html`<li>${item.path} · ${item.reason}</li>`)}</ul>
        <p>${t("setup.review.original")}</p>${input.preparation ? html`<section><h2>${t("setup.preparation.title")}</h2><p>${t("setup.preparation.flow")}</p>${input.preparation.verificationRoom ? html`<p data-verification-room-policy="${input.preparation.verificationRoom.policy}">${t("setup.batched.roomPolicy", { bytes: input.preparation.verificationRoom.targetBytes })}</p>` : html``}<p>${t("setup.preparation.parts", { groups: input.preparation.groupCount, parts: input.preparation.partCount })}</p><p>${t("setup.preparation.allowance", preparationAllowanceParams(input.preparation.allowance))}</p><p>${t("setup.preparation.uncertain")}</p>${input.preparation.reason ? html`<p role="status">${t(preparationReasonKey(input.preparation.reason))}</p><p>${t(input.preparation.purpose ? "setup.analysisOnlyBudget" : "setup.batched.windowBudget")}</p>` : html``}</section>` : html`<p>${t("setup.review.windows")}</p>`}
       <h2>${t("setup.review.selected")}</h2><ul data-selected>${setup.analysis.scope.selected.map((resource) => html`<li>${t("revision.blocks", { path: resource.resourcePath, count: resource.blockIds.length })}</li>`)}</ul>
       ${input.preparation?.state === "blocked" ? html`<h3>${t("setup.refusal.unsent")}</h3><ul>${input.preparation.unsentRanges.map((range) => html`<li>${range.resourcePath} · ${range.blockId} · UTF-16 [${range.start}, ${range.end})</li>`)}</ul>` : html``}
     <h2>${t("setup.review.excluded")}</h2><ul data-excluded>${input.normalization.resources.filter((resource) => !setup.analysis.scope.selected.some((selection) => selection.resourcePath === resource.path)).map((resource) => html`<li>${resource.path}${resource.status === "excluded" ? ` · ${t("setup.review.unavailable", { reason: resource.reason })}` : ""}</li>`)}</ul>
        ${LocalSubscriptionProvider.safeParse(setup.analysis.provider).success ? html`<section aria-label="${t("subscription.executionTitle")}"><h3>${t("subscription.executionTitle")}</h3><p>${t("subscription.requestScope")}</p><p>${t("subscription.executionLimits")}</p><p>${t("subscription.executionTrust")}</p><p>${t("subscription.identityBinding")}</p></section>` : html`<p>${t("setup.review.limits")}</p>`}
        ${batchedMarkup(input.preparation?.batchedMaximum, locale, Boolean(input.preparation?.purpose))}
      <p>${t("setup.review.timeouts")}</p>
      ${available && current ? html`<p ${!effectiveBlockedKey ? html`id="setup-send-reason"` : html``}>${t("setup.review.available")}</p>` : html`<p role="status">${t("setup.review.providerUnavailable")}</p>`}
     <form method="post" action="/sources/${setup.analysis.normalizationRevisionId}/setup/${setup.id}?lang=${locale}${input.studyQuery ? `&${input.studyQuery}` : ""}"><div class="setup-actions">
          ${effectiveBlockedKey ? html`<p id="setup-send-reason" role="status">${t(effectiveBlockedKey)}</p>` : html``}
          <button name="decision" value="send" aria-describedby="setup-send-reason" ${effectiveBlockedKey ? html`disabled` : html``}>${t("setup.send")}</button>
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
