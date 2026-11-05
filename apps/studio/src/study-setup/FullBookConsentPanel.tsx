import { useEffect, useRef, useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { type FullBookReview, FullBookRun } from "./full-book-client.ts"

export function FullBookConsentPanel(
  props: Readonly<{ review: FullBookReview; onSaved: (run: FullBookRun) => void }>,
) {
  const { t } = useLanguage(),
    { review } = props
  const [checked, setChecked] = useState({
    readableAndDerived: false,
    appBoundedNotProviderLimits: false,
    coverageAndOmissions: false,
    budgetAndUnknown: false,
  })
  const [id] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const active = useRef<AbortController | null>(null),
    alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => () => active.current?.abort(), [])
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  const details = review.consent,
    build = review.runtime?.build,
    recipient = review.route.recipient
  if (
    !details ||
    !build ||
    !recipient ||
    !review.hierarchy.policy ||
    review.runtime?.collectorBytes === undefined ||
    review.runtime.timeoutMs === undefined
  )
    return <p role="status">{t("fullBook.runtimeUnavailable")}</p>
  const labels = {
    readableAndDerived: t("fullBook.ackContent"),
    appBoundedNotProviderLimits: t("fullBook.ackLimits"),
    coverageAndOmissions: t("fullBook.ackCoverage", {
      coverage: t(
        details.coverage === "partial" ? "source.coverage.partial" : "source.coverage.complete",
      ),
      count: details.omissionCount,
    }),
    budgetAndUnknown: t("fullBook.ackBudget", {
      maximum: details.maxAttempts,
      spent: details.priorSpent,
      unknown: details.priorUnknown,
      unknownUsage: details.priorUsageUnknown,
      held: details.priorHeld,
      ceiling: details.sourceCeiling,
    }),
  }
  async function save() {
    if (active.current || !Object.values(checked).every(Boolean)) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError("")
    const base = `/api/full-book-test/${encodeURIComponent(review.setupId)}`
    const schema = FullBookRun.refine(
      (value) => value.id === id && value.setupId === review.setupId,
    )
    try {
      const state = await sourceCommand(
        `${base}/consent`,
        {
          submissionId: id,
          options: {
            mode: review.mode,
            policy: review.hierarchy.policy,
            sourceCeiling: review.budget.sourceCeiling,
            collectorBytes: review.runtime?.collectorBytes,
            timeoutMs: review.runtime?.timeoutMs,
          },
          reviewBinding: review.reviewBinding,
          acknowledgements: { ...details, ...checked },
        },
        schema,
        controller.signal,
      )
      if (!controller.signal.aborted) props.onSaved(state)
    } catch (failure) {
      if (controller.signal.aborted) return
      if (!(failure instanceof Error)) throw failure
      try {
        const stored = await sourceRequest(`${base}/runs/${id}`, schema, controller.signal)
        if (!controller.signal.aborted) props.onSaved(stored)
      } catch (readError) {
        if (!(readError instanceof Error)) throw readError
        if (!controller.signal.aborted) setError(t("fullBook.consentError"))
      }
    } finally {
      if (active.current === controller) {
        active.current = null
        setBusy(false)
      }
    }
  }
  return (
    <section className="full-book-consent-panel" aria-labelledby="full-book-consent-heading">
      <h2 id="full-book-consent-heading">{t("fullBook.consentHeading")}</h2>
      {build.kind === "fixture-not-live-evidence" && <p>{t("fullBook.fixtureRuntime")}</p>}
      <dl className="full-book-consent-details">
        <dt>{t("fullBook.recipient")}</dt>
        <dd>
          {review.route.provider} / {review.route.model}
          <br />
          {recipient.observedAccount?.email ??
            recipient.observedAccount?.accountId ??
            recipient.accountId}
          <br />
          {recipient.workspaceId ?? t("subscription.observationUnknown")} ·{" "}
          {recipient.installationId}
        </dd>
        <dt>{t("fullBook.hierarchyPolicy")}</dt>
        <dd>{review.hierarchy.policyVersion}</dd>
        <dt>{t("fullBook.runtimeBinding")}</dt>
        <dd>
          <code>{details.runtimeBinding}</code>
        </dd>
        <dt>{t("fullBook.planBinding")}</dt>
        <dd>
          <code>{details.planBinding}</code>
        </dd>
        <dt>{t("fullBook.runtimeIdentity")}</dt>
        <dd>
          {build.version}
          <code>{build.sha256}</code>
        </dd>
      </dl>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <fieldset disabled={busy}>
          <legend>{t("fullBook.consentHeading")}</legend>
          {(
            [
              "readableAndDerived",
              "appBoundedNotProviderLimits",
              "coverageAndOmissions",
              "budgetAndUnknown",
            ] as const
          ).map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={checked[key]}
                onChange={(event) =>
                  setChecked((current) => ({ ...current, [key]: event.target.checked }))
                }
              />
              {labels[key]}
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          disabled={
            busy ||
            !Object.values(checked).every(Boolean) ||
            !review.budget.fits ||
            review.canConsent === false
          }
        >
          {t("fullBook.saveConsent")}
        </button>
      </form>
      {busy && <p role="status">{t("fullBook.savingConsent")}</p>}
      {error && (
        <p role="alert" ref={alert} tabIndex={-1}>
          {error}
        </p>
      )}
    </section>
  )
}
