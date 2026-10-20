import type { CatalogKey } from "@reading-studio/contracts/i18n"
import type { InterviewReadiness as Readiness } from "@reading-studio/contracts/interview"
import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"

const reasonCopy: Readonly<Partial<Record<string, CatalogKey>>> = {
  outcome_unknown: "interview.readiness.reason.unknown",
  "budget-exhausted": "interview.readiness.reason.budget",
  "input-limit": "interview.readiness.reason.input",
  owner: "interview.readiness.reason.held",
  restored: "interview.readiness.reason.restored",
  "missing-credentials": "interview.readiness.reason.connection",
  unauthorized: "interview.readiness.reason.connection",
  "subscription-unverified": "interview.readiness.reason.connection",
  "subscription-connection-changed": "interview.readiness.reason.connection",
}

export function InterviewReadiness({ value }: { readonly value: Readiness }): ReactElement {
  const { locale, t } = useLanguage()
  const link = (href: string) => `${href}${href.includes("?") ? "&" : "?"}lang=${locale}`
  switch (value.kind) {
    case "missing-study":
      return (
        <section className="setup workspace-error">
          <h1>{t("interview.readiness.missing")}</h1>
          <p>{t("interview.readiness.missingBody")}</p>
          <a href={link("/sources")}>{t("interview.unavailable.back")}</a>
        </section>
      )
    case "setup-required":
    case "review-required":
      return (
        <section className="setup">
          <h1>{t(`interview.readiness.${value.kind}`)}</h1>
          <p>
            {t(
              value.kind === "setup-required"
                ? "interview.readiness.setupBody"
                : "interview.readiness.consent",
            )}
          </p>
          <a href={link(value.actionHref)}>{t(`interview.readiness.${value.kind}`)}</a>
        </section>
      )
    case "ready":
      return (
        <section className="setup">
          <h1>{t("interview.readiness.ready")}</h1>
          <a href={link(value.actionHref)}>{t("interview.readiness.open")}</a>
        </section>
      )
    case "progress":
      return (
        <section className="setup">
          <p className="eyebrow">{t("interview.eyebrow")}</p>
          <h1>{t(`interview.readiness.${value.stage}`)}</h1>
          <p role="status">{t(`interview.readiness.${value.state}`)}</p>
          {value.reason && (
            <>
              <p>
                {t("interview.readiness.reason")} <code>{value.reason}</code>
              </p>
              <p>{t(reasonCopy[value.reason] ?? "interview.readiness.reason.generic")}</p>
            </>
          )}
          <p>{t("interview.readiness.noAutomatic")}</p>
          <a href={link(value.actionHref)}>{t("interview.readiness.progress")}</a>
        </section>
      )
    default:
      return assertNever(value)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected interview readiness: ${value}`)
}
