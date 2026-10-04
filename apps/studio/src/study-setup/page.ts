import type { NormalizationRevision, StudySetupRevision } from "@reading-studio/contracts"
import { html } from "hono/html"
import { sourcePage } from "../source-viewer/page.ts"

export function setupChoices(input: {
  readonly normalization: NormalizationRevision
  readonly choices: readonly {
    readonly provider: string
    readonly model: string
    readonly label: string
  }[]
}) {
  const { normalization, choices } = input
  const main = normalization.resources.filter((resource) => resource.role === "main-chapter")
  const complete = main.length > 0 && main.every((resource) => resource.status === "included")
  return sourcePage(
    "Set up a study",
    html`
    <section class="setup"><p class="eyebrow">STUDY / PRIVATE BY DEFAULT</p><h1>Set up a study</h1>
    <p>Choose what leaves this device. Nothing is sent until you review and approve transmission.</p>
    <p><a href="/sources/${normalization.id}">Back to source preview</a></p>
    <form method="post" action="/sources/${normalization.id}/setup">
      <label for="provider">Provider and model</label><select id="provider" name="provider">${choices.map((choice) => html`<option value="${choice.provider}">${choice.label}</option>`)}</select>
      <fieldset><legend>Source scope</legend>
        <label><input type="radio" name="scope" value="all-main-chapters" ${complete ? html`checked` : html`disabled`}> All main chapters</label>
        <label><input type="radio" name="scope" value="partial" ${complete ? html`` : html`checked`}> Choose specific chapters</label>
        ${complete ? html`` : html`<p>Some main chapters are unavailable. Only explicit partial scope is possible.</p>`}
        ${normalization.resources.map((resource) => (resource.status === "included" ? html`<label><input type="checkbox" name="chapters" value="${resource.path}"> ${resource.path}</label>` : html`<p>Unavailable: ${resource.path} (${resource.reason})</p>`))}
      </fieldset><p>API access is separate from ChatGPT or Claude chat subscriptions. Keys stay on the server.</p>
      <button type="submit">Review transmission</button>
    </form></section>`,
  )
}

export function setupReview(input: {
  readonly setup: StudySetupRevision
  readonly normalization: NormalizationRevision
  readonly available: boolean
}) {
  const { setup, available } = input
  return sourcePage(
    "Review transmission",
    html`
    <section class="setup"><p class="eyebrow">STUDY / TRANSMISSION REVIEW</p><h1>Review transmission</h1>
    <h2>${setup.analysis.provider} / ${setup.analysis.model}</h2>
    <p>Scope: ${setup.analysis.scope.kind}. Sending authorizes selected book text, analysis-derived study material and, after you approve a reading brief, that brief's reader context to the selected provider for this exact setup. No excluded resources or unapproved drafts are sent.</p>
    <h2>Selected resources</h2><ul data-selected>${setup.analysis.scope.selected.map((resource) => html`<li>${resource.resourcePath} · ${resource.blockIds.length} blocks</li>`)}</ul>
    <h2>Excluded from transmission</h2><ul data-excluded>${input.normalization.resources.filter((resource) => !setup.analysis.scope.selected.some((selection) => selection.resourcePath === resource.path)).map((resource) => html`<li>${resource.path}${resource.status === "excluded" ? ` · unavailable: ${resource.reason}` : ""}</li>`)}</ul>
    <p>Studio limits: 64 calls; 32,000 serialized request bytes and 6,000 output tokens per call. Codex output is checked after receipt, not capped by its protocol. Oversized replies pause the job. All attempts count toward the call budget.</p>
    <p>Timeouts with an unknown outcome pause for your decision. Providers may charge for accepted attempts. No provider switching or hidden retries.</p>
    ${available ? html`<p>Server API credential configured.</p>` : html`<p role="status">API credential missing. Configure the selected provider on the server, then return here. A chat subscription is not an API credential.</p>`}
    <form method="post" action="/sources/${setup.analysis.normalizationRevisionId}/setup/${setup.id}"><div class="setup-actions">
      <button name="decision" value="send" ${available ? html`` : html`disabled`}>Send</button>
      <button name="decision" value="revise">Revise</button><button name="decision" value="cancel">Cancel</button>
    </div></form><p><small>Setup revision: ${setup.id}</small></p></section>`,
  )
}

export function setupResult(input: {
  readonly title: string
  readonly message: string
  readonly revision: string
  readonly grantId?: string
}) {
  return sourcePage(
    input.title,
    html`<section class="setup"><h1>${input.title}</h1><p>${input.message}</p>${input.grantId ? html`<p data-grant="${input.grantId}">Consent saved for this exact setup.</p>` : html``}<p><a href="/sources/${input.revision}/setup">Return to setup</a></p></section>`,
  )
}
