import type { ReactElement } from "react"
import type { z } from "zod"
import type { SetupReview as ReviewSchema } from "./client.ts"

type Review = z.infer<typeof ReviewSchema>

export function SetupReview({
  value,
  onDecision,
  busy,
}: {
  readonly value: Review
  readonly onDecision: (decision: "send" | "revise" | "cancel") => void
  readonly busy: boolean
}): ReactElement {
  const { setup, normalization, available } = value
  return (
    <section className="setup">
      <p className="eyebrow">STUDY / TRANSMISSION REVIEW</p>
      <h1>Review transmission</h1>
      <h2>
        {setup.analysis.provider} / {setup.analysis.model}
      </h2>
      <p>
        Scope: {setup.analysis.scope.kind}. Sending authorizes selected book text, analysis-derived
        study material and, after you approve a reading brief, that brief&apos;s reader context to
        the selected provider for this exact setup. No excluded resources or unapproved drafts are
        sent.
      </p>
      <h2>Selected resources</h2>
      <ul data-selected>
        {setup.analysis.scope.selected.map((resource) => (
          <li key={resource.resourcePath}>
            {resource.resourcePath} · {resource.blockIds.length} blocks
          </li>
        ))}
      </ul>
      <h2>Excluded from transmission</h2>
      <ul data-excluded>
        {normalization.resources
          .filter(
            (resource) =>
              !setup.analysis.scope.selected.some(
                (selection) => selection.resourcePath === resource.path,
              ),
          )
          .map((resource) => (
            <li key={resource.path}>
              {resource.path}
              {resource.status === "excluded" ? ` · unavailable: ${resource.reason}` : ""}
            </li>
          ))}
      </ul>
      <p>
        Limits per run: 64 calls; 32,000 source characters and 6,000 output tokens per call; up to 2
        explicitly approved transient retries and 1 malformed-output repair. All attempts count
        toward the call budget.
      </p>
      <p>
        Timeouts with an unknown outcome pause for your decision. Providers may charge for accepted
        attempts. No provider switching or hidden retries.
      </p>
      {available ? (
        <p>Server API credential configured.</p>
      ) : (
        <p role="status">
          API credential missing. Configure the selected provider on the server, then return here. A
          chat subscription is not an API credential.
        </p>
      )}
      <div className="setup-actions">
        <button type="button" disabled={!available || busy} onClick={() => onDecision("send")}>
          Send
        </button>
        <button type="button" disabled={busy} onClick={() => onDecision("revise")}>
          Revise
        </button>
        <button type="button" disabled={busy} onClick={() => onDecision("cancel")}>
          Cancel
        </button>
      </div>
      <p>
        <small>Setup revision: {setup.id}</small>
      </p>
    </section>
  )
}
