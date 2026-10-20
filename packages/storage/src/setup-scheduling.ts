import { GrantId, SetupSchedulingFailure } from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"

export class SetupSchedulingRepository {
  constructor(private readonly context: StorageContext) {}

  failure(input: unknown): SetupSchedulingFailure | null {
    const id = GrantId.parse(input)
    const row = this.context.sqlite
      .prepare("SELECT failure_code FROM setup_scheduling WHERE grant_id = ?")
      .get(id)
    return row
      ? z.object({ failure_code: SetupSchedulingFailure.nullable() }).parse(row).failure_code
      : null
  }

  record(input: unknown): void {
    const value = z
      .strictObject({ grantId: GrantId, failure: SetupSchedulingFailure.nullable() })
      .parse(input)
    this.context.sqlite
      .prepare(
        "INSERT INTO setup_scheduling (grant_id, failure_code) VALUES (?, ?) ON CONFLICT(grant_id) DO UPDATE SET failure_code=excluded.failure_code",
      )
      .run(value.grantId, value.failure)
  }
}
