import type { ReactElement } from "react"
import type { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
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
  const { t } = useLanguage()
  const { setup, normalization, available } = value
  return (
    <section className="setup">
      <p className="eyebrow">{t("setup.review.eyebrow")}</p>
      <h1>{t("setup.review")}</h1>
      <h2>
        {setup.analysis.provider} / {setup.analysis.model}
      </h2>
      <p>
        {t("setup.review.scope", {
          scope: t(
            setup.analysis.scope.kind === "whole-document"
              ? "brief.scope.whole"
              : setup.analysis.scope.kind === "partial"
                ? "brief.scope.partial"
                : "brief.scope.main",
          ),
        })}
      </p>
      <h2>{t("setup.review.extraction")}</h2>
      <p>
        {t("setup.review.coverage", {
          coverage: t(
            normalization.coverage === "complete"
              ? "source.coverage.complete"
              : "source.coverage.partial",
          ),
        })}
      </p>
      <ul>
        {normalization.omissions?.map((item) => (
          <li key={`${item.path}-${item.reason}`}>
            {item.path} · {item.reason}
          </li>
        ))}
      </ul>
      <p>{t("setup.review.original")}</p>
      <p>{t("setup.review.windows")}</p>
      <h2>{t("setup.review.selected")}</h2>
      <ul data-selected>
        {setup.analysis.scope.selected.map((resource) => (
          <li key={resource.resourcePath}>
            {t("revision.blocks", { path: resource.resourcePath, count: resource.blockIds.length })}
          </li>
        ))}
      </ul>
      <h2>{t("setup.review.excluded")}</h2>
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
              {resource.status === "excluded"
                ? ` · ${t("setup.review.unavailable", { reason: resource.reason })}`
                : ""}
            </li>
          ))}
      </ul>
      <p>{t("setup.review.limits")}</p>
      <p>{t("setup.review.timeouts")}</p>
      {available ? (
        <p>{t("setup.review.available")}</p>
      ) : (
        <p role="status">{t("setup.review.providerUnavailable")}</p>
      )}
      <div className="setup-actions">
        <button type="button" disabled={!available || busy} onClick={() => onDecision("send")}>
          {t("setup.send")}
        </button>
        <button type="button" disabled={busy} onClick={() => onDecision("revise")}>
          {t("brief.revise")}
        </button>
        <button type="button" disabled={busy} onClick={() => onDecision("cancel")}>
          {t("setup.cancel")}
        </button>
      </div>
      <p>
        <small>{t("setup.revision", { id: setup.id })}</small>
      </p>
    </section>
  )
}
