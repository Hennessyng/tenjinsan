import { InstallationId, type SubscriptionProvider } from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"

const Revision = z.object({ revision: z.number().int().nonnegative() })

// No tokens or account data: only a durable revocation fence, excluded from backups.
export class SubscriptionConnections {
  constructor(private readonly context: StorageContext) {}

  revision(installationId: string, provider: SubscriptionProvider): number {
    const row = this.context.sqlite
      .prepare(
        "SELECT revision FROM subscription_connections WHERE installation_id = ? AND provider = ?",
      )
      .get(InstallationId.parse(installationId), provider)
    return row ? Revision.parse(row).revision : 0
  }

  disconnect(installationId: string, provider: SubscriptionProvider): number {
    const row = this.context.sqlite
      .prepare(`
      INSERT INTO subscription_connections (installation_id, provider, revision) VALUES (?, ?, 1)
      ON CONFLICT(installation_id, provider) DO UPDATE SET revision = revision + 1
      RETURNING revision
    `)
      .get(InstallationId.parse(installationId), provider)
    return Revision.parse(row).revision
  }
}
