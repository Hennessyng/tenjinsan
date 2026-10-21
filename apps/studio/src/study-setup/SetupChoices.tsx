import { wholeBookScope } from "@reading-studio/contracts/source-scope"
import {
  isSubscriptionProvider,
  type SubscriptionSnapshot,
} from "@reading-studio/contracts/subscriptions"
import type { FormEvent, ReactElement } from "react"
import { useCallback, useState } from "react"
import { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { SourceRequestError, sourceCommand } from "../source-viewer/client.ts"
import type { SetupChoices as ChoicesSchema, SetupSelection } from "./client.ts"
import { SubscriptionConnections } from "./SubscriptionConnections.tsx"

type Choices = z.infer<typeof ChoicesSchema>
const choiceKey = (choice: Choices["choices"][number]) => `${choice.provider}/${choice.model}`

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
  const { normalization } = value
  const [localChoices, setLocalChoices] = useState(
    value.choices.filter((choice) => isSubscriptionProvider(choice.provider)),
  )
  const choices = [
    ...value.choices.filter((choice) => !isSubscriptionProvider(choice.provider)),
    ...localChoices,
  ]
  const updateCatalog = useCallback((snapshot: SubscriptionSnapshot) => {
    setLocalChoices(
      snapshot.connections.flatMap((connection) =>
        connection.canDispatch
          ? connection.models.map((model) => ({
              provider: connection.provider,
              model: model.model,
              label: `${connection.provider} / ${model.label}`,
            }))
          : [],
      ),
    )
  }, [])
  const extracted = wholeBookScope(normalization) !== null
  const omitted = normalization.resources.filter((resource) => resource.status === "excluded")
  const codexAvailable = choices.some((choice) => choice.provider === "codex")
  const [selection, setSelection] = useState(choices[0] ? choiceKey(choices[0]) : "")
  const selectedChoice = choices.find((choice) => choiceKey(choice) === selection)
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
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const choice = selectedChoice
    if (choice && extracted) onSubmit({ provider: choice.provider, model: choice.model })
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
            value={selectedChoice ? selection : ""}
            onChange={(event) => setSelection(event.target.value)}
          >
            <option value="" disabled>
              {t("setup.chooseModel")}
            </option>
            {choices.map((choice) => (
              <option key={choiceKey(choice)} value={choiceKey(choice)}>
                {choice.label}
              </option>
            ))}
          </select>
        </section>
        <section className="setup-coverage" aria-labelledby="coverage-heading">
          <h2 id="coverage-heading">{t("setup.review.selected")}</h2>
          {extracted ? (
            <>
              <p>{t("setup.coverage.whole")}</p>
              <ul data-included>
                {normalization.resources.map((resource) =>
                  resource.status === "included" ? (
                    <li key={resource.path}>
                      {t("revision.blocks", { path: resource.path, count: resource.blocks.length })}
                    </li>
                  ) : null,
                )}
              </ul>
            </>
          ) : (
            <p role="status">{t("setup.coverage.empty")}</p>
          )}
          {omitted.length > 0 && (
            <>
              <p>{t("setup.coverage.omitted")}</p>
              <ul data-omitted>
                {omitted.map((resource) => (
                  <li key={resource.path}>
                    {t("setup.resourceUnavailable", {
                      path: resource.path,
                      reason: resource.reason,
                    })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <p>{t("setup.caps")}</p>
        <button type="submit" disabled={busy || !selectedChoice || !extracted}>
          {t("setup.review")}
        </button>
      </form>
      <SubscriptionConnections onCatalog={updateCatalog} />
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
