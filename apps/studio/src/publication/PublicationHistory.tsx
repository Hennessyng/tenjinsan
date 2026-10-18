import type { ReactElement } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import type { Publication } from "./client.ts"
import { exportInterfaceLabel, pendingOutputLabel } from "./copy.ts"

export function PublicationHistory({
  value,
  busy,
  onGenerate,
}: {
  readonly value: Publication
  readonly busy: boolean
  readonly onGenerate: (id: string) => void
}): ReactElement {
  const { t } = useLanguage()
  const { history } = value
  return (
    <>
      <h2>{t("publication.history")}</h2>
      <p>{t("publication.history.retry")}</p>
      <aside className="publication-note" aria-label={t("publication.downloadNote")}>
        <strong>{t("publication.lastStop")}</strong>
        <span>{t("publication.versionedNote")}</span>
      </aside>
      {history.length ? (
        history.map(({ snapshot, current, outputs }, index) => (
          <section className="publication-edition" key={snapshot.publication.id}>
            <h3>
              {t("publication.version", { n: history.length - index })} ·{" "}
              {current ? t("publication.currentApproval") : t("publication.stale")}
            </h3>
            <p className="metadata">
              {snapshot.publication.id}
              <br />
              {snapshot.publication.approval.rendererVersion}
              <br />
              {snapshot.publication.approval.approvedAt}
            </p>
            <p className="metadata">
              {t("publication.history.ui", {
                language: exportInterfaceLabel(snapshot.exportUi ?? outputs[0]?.exportUi, t),
              })}
            </p>
            <ul className="publication-volumes">
              {outputs.map((output) => (
                <li className="publication-volume" data-format={output.format} key={output.id}>
                  <strong>
                    {t("publication.lessonFormat", { format: output.format.toUpperCase() })}
                  </strong>
                  <span className="publication-output-state">
                    {output.state === "released"
                      ? current
                        ? t("publication.current")
                        : t("publication.old")
                      : output.state === "failed"
                        ? t("publication.outputError", { error: output.error ?? "" })
                        : t("publication.notAvailable", {
                            state: pendingOutputLabel(output.state, t),
                          })}
                  </span>
                  {output.state === "released" && (
                    <span className="publication-format-note">
                      {output.format === "html" ? t("publication.browser") : t("publication.print")}
                    </span>
                  )}
                  {output.state === "released" && (
                    <a
                      className="publication-download"
                      href={`/publication-artifacts/${output.id}`}
                    >
                      {t("publication.download", {
                        format: output.format.toUpperCase(),
                        n: history.length - index,
                      })}
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {current && outputs.some((output) => output.state === "queued") && (
              <div className="setup-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onGenerate(snapshot.publication.id)}
                >
                  {t("publication.generate")}
                </button>
              </div>
            )}
          </section>
        ))
      ) : (
        <p className="workspace-empty">{t("publication.empty")}</p>
      )}
    </>
  )
}
