import type { FormEvent, ReactElement } from "react"
import { useState } from "react"
import { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { SourceRequestError, sourceCommand } from "../source-viewer/client.ts"
import type { SetupChoices as ChoicesSchema, SetupSelection } from "./client.ts"

type Choices = z.infer<typeof ChoicesSchema>

export function SetupChoices({
  value,
  onSubmit,
  busy,
}: {
  readonly value: Choices
  readonly onSubmit: (selection: SetupSelection) => void
  readonly busy: boolean
}): ReactElement {
  const { t } = useLanguage()
  const { normalization, choices } = value
  const main = normalization.resources.filter((resource) => resource.role === "main-chapter")
  const complete = main.length > 0 && main.every((resource) => resource.status === "included")
  const codexAvailable = choices.some((choice) => choice.provider === "codex")
  const [selection, setSelection] = useState("0")
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [connectionBusy, setConnectionBusy] = useState(false)
  const [connectionError, setConnectionError] = useState(false)
  async function connection(action: "connect" | "disconnect") {
    setConnectionBusy(true)
    setConnectionError(false)
    try {
      const result = await sourceCommand(
        `/api/provider-connections/codex/${action}`,
        {},
        z.object({ authUrl: z.url().optional() }),
      )
      setAuthUrl(result.authUrl ?? null)
      if (action === "disconnect") window.location.reload()
    } catch (error) {
      if (error instanceof SourceRequestError) setConnectionError(true)
      else throw error
    } finally {
      setConnectionBusy(false)
    }
  }
  const [scope, setScope] = useState<SetupSelection["scope"]>("whole-document")
  const [chapters, setChapters] = useState<readonly string[]>([])
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const choice = choices[Number(selection)]
    if (choice) onSubmit({ provider: choice.provider, model: choice.model, scope, chapters })
  }
  return (
    <section className="setup">
      <p className="eyebrow">{t("setup.eyebrow")}</p>
      <h1>{t("setup.title")}</h1>
      <p>{t("setup.intro")}</p>
      <p>
        <a href={`/sources/${normalization.id}`}>{t("setup.sourcePreview")}</a>
      </p>
      <form onSubmit={submit}>
        <section className="setup-provider-paper" aria-labelledby="provider-paper-title">
          <span id="provider-paper-title" title={t("revision.provider.label")} />
          <label id="provider-label" htmlFor="provider">
            {t("revision.provider.label")}
          </label>
          <select
            id="provider"
            value={selection}
            onChange={(event) => setSelection(event.target.value)}
          >
            {choices.map((choice, index) => (
              <option key={`${choice.provider}/${choice.model}`} value={index}>
                {choice.label}
              </option>
            ))}
          </select>
        </section>
        <fieldset>
          <legend>{t("setup.scope")}</legend>
          <label>
            <input
              type="radio"
              name="scope"
              value="whole-document"
              checked={scope === "whole-document"}
              onChange={() => setScope("whole-document")}
            />{" "}
            {t("setup.scope.whole")}
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              value="all-main-chapters"
              checked={scope === "all-main-chapters"}
              disabled={!complete}
              onChange={() => setScope("all-main-chapters")}
            />{" "}
            {t("setup.scope.main")}
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              value="partial"
              checked={scope === "partial"}
              onChange={() => setScope("partial")}
            />{" "}
            {t("setup.scope.partial")}
          </label>
          {!complete && <p>{t("setup.scope.incomplete")}</p>}
          {normalization.resources.map((resource) =>
            resource.status === "included" ? (
              <label key={resource.path}>
                <input
                  type="checkbox"
                  checked={chapters.includes(resource.path)}
                  onChange={(event) =>
                    setChapters(
                      event.target.checked
                        ? [...chapters, resource.path]
                        : chapters.filter((path) => path !== resource.path),
                    )
                  }
                />{" "}
                {resource.path}
              </label>
            ) : (
              <p key={resource.path}>
                {t("setup.resourceUnavailable", { path: resource.path, reason: resource.reason })}
              </p>
            ),
          )}
        </fieldset>
        <p>{t("setup.caps")}</p>
        <button type="submit" disabled={busy || !choices[Number(selection)]}>
          {t("setup.review")}
        </button>
      </form>
      <section className="setup-connection-slip" aria-labelledby="connection-heading">
        <p className="eyebrow">{t("setup.connection.eyebrow")}</p>
        <h2 id="connection-heading">{t("setup.connection.title")}</h2>
        <section className="setup-key-provider-note" aria-labelledby="key-provider-heading">
          <h3 id="key-provider-heading">{t("setup.connection.keys")}</h3>
          <p>{t("setup.connection.keyNote")}</p>
        </section>
        <section className="setup-codex-ticket" aria-labelledby="codex-connection-heading">
          <div className="setup-codex-ticket-heading">
            <div>
              <p className="setup-ticket-number">{t("setup.connection.official")}</p>
              <h3 id="codex-connection-heading">{t("setup.connection.subscription")}</h3>
            </div>
            <p className="setup-connection-stamp" role="status">
              {codexAvailable ? t("setup.connection.connected") : t("setup.connection.unavailable")}
            </p>
          </div>
          <p>{t("setup.connection.note")}</p>
          <dl className="setup-connection-details">
            <dt>{t("setup.connection.desk")}</dt>
            <dd>{t("setup.connection.deskName")}</dd>
            <dt>{t("setup.connection.access")}</dt>
            <dd>{t("setup.connection.method")}</dd>
          </dl>
          <p
            className={
              codexAvailable ? "setup-connection-state" : "setup-connection-state workspace-empty"
            }
          >
            {codexAvailable ? t("setup.connection.models") : t("setup.connection.noModels")}
          </p>
          {connectionError && <p role="alert">{t("setup.connection.error")}</p>}
          {authUrl && (
            <p>
              <a href={authUrl} target="_blank" rel="noreferrer">
                {t("setup.connection.continue")}
              </a>
            </p>
          )}
          <div className="setup-actions">
            <button
              type="button"
              disabled={connectionBusy}
              onClick={() => void connection("connect")}
            >
              {t("setup.connection.connect")}
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              {t("setup.connection.refresh")}
            </button>
            <button
              type="button"
              disabled={connectionBusy}
              onClick={() => void connection("disconnect")}
            >
              {t("setup.connection.disconnect")}
            </button>
          </div>
        </section>
      </section>
    </section>
  )
}
