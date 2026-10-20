import { randomUUID } from "node:crypto"
import {
  InstallationId,
  type LocalSubscriptionProvider,
  LocalSubscriptionSession,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import type { SubscriptionConnections } from "./subscription-connections.ts"

export class SubscriptionLoginError extends Error {
  override readonly name = "SubscriptionLoginError"
  constructor(
    readonly code:
      | "connection-busy"
      | "tool-unavailable"
      | "login-failed"
      | "connection-changed"
      | "protocol-error"
      | "custom-configuration",
  ) {
    super(code)
  }
}
export class SubscriptionSessionStore {
  constructor(
    private readonly context: StorageContext,
    private readonly fences: SubscriptionConnections,
    readonly provider: LocalSubscriptionProvider = "chatgpt-subscription",
  ) {}
  status(installation: string): LocalSubscriptionSession {
    const id = InstallationId.parse(installation)
    const revision = this.fences.revision(id, this.provider)
    const row = this.context.sqlite
      .prepare(
        "SELECT record_json FROM subscription_sessions WHERE installation_id = ? AND provider = ?",
      )
      .get(id, this.provider)
    if (row) {
      const state = LocalSubscriptionSession.parse(
        JSON.parse(z.object({ record_json: z.string() }).parse(row).record_json),
      )
      if (state.connectionRevision === revision) return state
    }
    return {
      status: "disconnected",
      generation: null,
      connectionRevision: revision,
      billingRoute: "subscription-provider-managed",
      authUrl: null,
      expiresAt: null,
      catalog: "not-checked",
      account: null,
      models: [],
    }
  }
  begin(installation: string): LocalSubscriptionSession {
    return this.context.sqlite
      .transaction(() => {
        const revision = this.fences.disconnect(installation, this.provider)
        const state = LocalSubscriptionSession.parse({
          ...this.status(installation),
          status: "pending",
          generation: randomUUID(),
          connectionRevision: revision,
          expiresAt: Date.now() + 300000,
        })
        this.save(installation, state)
        return state
      })
      .immediate()
  }
  save(installation: string, state: LocalSubscriptionSession): boolean {
    return this.context.sqlite
      .transaction(() => {
        if (this.fences.revision(installation, this.provider) !== state.connectionRevision)
          return false
        this.context.sqlite
          .prepare(`INSERT INTO subscription_sessions (installation_id, provider, record_json)
        VALUES (?, ?, ?) ON CONFLICT (installation_id, provider)
        DO UPDATE SET record_json = excluded.record_json`)
          .run(InstallationId.parse(installation), this.provider, JSON.stringify(state))
        return true
      })
      .immediate()
  }
  disconnect(installation: string): LocalSubscriptionSession {
    return this.context.sqlite
      .transaction(() => {
        this.fences.disconnect(installation, this.provider)
        const state = this.status(installation)
        this.save(installation, state)
        return state
      })
      .immediate()
  }
  expire(installation: string, previous: LocalSubscriptionSession): void {
    this.save(installation, {
      ...previous,
      status: "expired",
      account: null,
      catalog: "failed",
      models: [],
    })
  }
  refreshed(installation: string, state: LocalSubscriptionSession): LocalSubscriptionSession {
    return this.context.sqlite
      .transaction(() => {
        const previous = this.status(installation)
        if (previous.connectionRevision !== state.connectionRevision)
          throw new SubscriptionLoginError("connection-changed")
        const changed = (["email", "accountId", "planType", "workspaceId"] as const).some(
          (field) => previous.account?.[field] !== state.account?.[field],
        )
        const next = changed
          ? {
              ...state,
              connectionRevision: this.fences.disconnect(installation, this.provider),
            }
          : state
        this.save(installation, next)
        return next
      })
      .immediate()
  }
}
