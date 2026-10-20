import {
  type SubscriptionProvider,
  SubscriptionSnapshot,
} from "@reading-studio/contracts/subscriptions"
import { useEffect, useState } from "react"
import { z } from "zod"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"

const names = {
  "chatgpt-subscription": "ChatGPT",
  "claude-subscription": "Claude",
  "grok-subscription": "Grok",
} as const
type State =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly snapshot: SubscriptionSnapshot }

export function SubscriptionConnections({
  onCatalog,
}: {
  readonly onCatalog?: (snapshot: SubscriptionSnapshot) => void
}) {
  const { t } = useLanguage()
  const [state, setState] = useState<State>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (state.kind === "ready") onCatalog?.(state.snapshot)
  }, [state, onCatalog])
  useEffect(() => {
    if (
      state.kind !== "ready" ||
      !state.snapshot.connections.some((connection) => connection.status === "pending")
    )
      return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void sourceRequest("/api/subscription-connections", SubscriptionSnapshot, controller.signal)
        .then((snapshot) => {
          if (!controller.signal.aborted) setState({ kind: "ready", snapshot })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          if (
            error instanceof SourceRequestError ||
            error instanceof z.ZodError ||
            error instanceof TypeError
          )
            setState({ kind: "failed" })
          else throw error
        })
    }, 1000)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [state])
  useEffect(() => {
    const controller = new AbortController()
    void sourceRequest("/api/subscription-connections", SubscriptionSnapshot, controller.signal)
      .then((snapshot) => {
        if (!controller.signal.aborted) setState({ kind: "ready", snapshot })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (
          error instanceof SourceRequestError ||
          error instanceof z.ZodError ||
          error instanceof TypeError
        )
          setState({ kind: "failed" })
        else throw error
      })
    return () => controller.abort()
  }, [])
  async function refresh(provider?: SubscriptionProvider, action = "disconnect") {
    setBusy(true)
    try {
      const snapshot = provider
        ? await sourceCommand(
            `/api/subscription-connections/${provider}/${action}`,
            {},
            SubscriptionSnapshot,
          )
        : await sourceRequest(
            "/api/subscription-connections",
            SubscriptionSnapshot,
            AbortSignal.timeout(10000),
          )
      setState({ kind: "ready", snapshot })
    } catch (error) {
      if (
        error instanceof SourceRequestError ||
        error instanceof z.ZodError ||
        error instanceof TypeError ||
        error instanceof DOMException
      )
        setState({ kind: "failed" })
      else throw error
    } finally {
      setBusy(false)
    }
  }
  function content() {
    switch (state.kind) {
      case "loading":
        return <p role="status">{t("subscription.loading")}</p>
      case "failed":
        return (
          <p role="alert" data-subscription-error="discovery-failed">
            {t("subscription.failed")}
          </p>
        )
      case "ready":
        return (
          <>
            <p>{t(`subscription.deployment.${state.snapshot.deployment}`)}</p>
            {state.snapshot.connections.map((connection) => (
              <section
                key={connection.provider}
                className="setup-codex-ticket"
                aria-labelledby={`subscription-${connection.provider}`}
              >
                <div className="setup-codex-ticket-heading">
                  <h3 id={`subscription-${connection.provider}`}>{names[connection.provider]}</h3>
                  <p className="setup-connection-stamp" role="status">
                    {t(`subscription.status.${connection.status}`)}
                  </p>
                </div>
                <p>
                  {t("subscription.candidate")}: <code>{connection.route}</code>
                </p>
                <p>{t("subscription.catalog")}</p>
                {connection.billingRoute && <p>{t("subscription.billing")}</p>}
                {connection.account && (
                  <p>
                    {connection.account.email ?? t("subscription.accountUnknown")} ·{" "}
                    {connection.account.planType}
                  </p>
                )}
                {connection.catalog === "checked" && (
                  <ul aria-label={t("subscription.offeredModels")}>
                    {connection.models.map((model) => (
                      <li key={model.model}>
                        {model.label} <code>{model.model}</code>
                      </li>
                    ))}
                  </ul>
                )}
                {connection.authUrl && (
                  <p>
                    <a href={connection.authUrl} target="_blank" rel="noopener noreferrer">
                      {t("subscription.continueLogin")}
                    </a>
                  </p>
                )}
                <details>
                  <summary>{t("subscription.prerequisites")}</summary>
                  <ul>
                    {connection.blockers.map((blocker) => (
                      <li key={blocker}>{t(`subscription.blocker.${blocker}`)}</li>
                    ))}
                  </ul>
                </details>
                <div className="setup-actions">
                  <button
                    type="button"
                    disabled={busy || !connection.canConnect}
                    onClick={() => void refresh(connection.provider, "connect")}
                  >
                    {t("subscription.connect", { provider: names[connection.provider] })}
                  </button>
                  {state.snapshot.deployment === "local" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void refresh(connection.provider)}
                    >
                      {t("subscription.disconnect", { provider: names[connection.provider] })}
                    </button>
                  )}
                  {state.snapshot.deployment === "local" &&
                    connection.provider !== "claude-subscription" &&
                    connection.status === "connected" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void refresh(connection.provider, "refresh")}
                      >
                        {t("subscription.refreshAccount")}
                      </button>
                    )}
                </div>
              </section>
            ))}
          </>
        )
      default:
        return assertNever(state)
    }
  }
  return (
    <section className="setup-connection-slip" aria-labelledby="subscription-heading">
      <h2 id="subscription-heading">{t("subscription.title")}</h2>
      <p>{t("subscription.partial")}</p>
      <p>{t("subscription.access")}</p>
      {content()}
      <button
        type="button"
        disabled={busy || state.kind === "loading"}
        onClick={() => void refresh()}
      >
        {t("subscription.refresh")}
      </button>
      <p>{t("subscription.disconnectNote")}</p>
    </section>
  )
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected subscription state: ${value}`)
}
