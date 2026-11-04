import type Database from "better-sqlite3"
import { z } from "zod"
import { BackupError } from "./backup-schema.ts"
import { BudgetRow, budgetStatus } from "./live-budget-state.ts"

export function validateBudgetGraph(sqlite: Database.Database): void {
  for (const value of sqlite.prepare("SELECT * FROM live_study_budgets").all()) {
    const group = BudgetRow.parse(value)
    if (group.kind !== "restored")
      throw new BackupError("restored live budget cannot grant authority")
    budgetStatus(sqlite, group.id)
    const adoption = z
      .object({
        members: z
          .array(z.object({ authorizationId: z.string(), expectedSpent: z.number() }))
          .min(1),
      })
      .parse(JSON.parse(group.adoption_json))
    for (const member of adoption.members) {
      const row = z
        .object({ reserved_calls: z.number() })
        .safeParse(
          sqlite
            .prepare(
              `SELECT g.reserved_calls FROM live_study_guards g JOIN live_study_budget_members m ON m.authorization_id=g.authorization_id JOIN live_study_retirements r ON r.authorization_id=g.authorization_id WHERE g.authorization_id=? AND m.budget_id=? AND r.budget_id=?`,
            )
            .get(member.authorizationId, group.id, group.id),
        )
      if (!row.success || row.data.reserved_calls !== member.expectedSpent)
        throw new BackupError("retirement or adopted budget history missing")
    }
  }
  for (const value of sqlite
    .prepare("SELECT target_json,authorization_id FROM live_study_guards")
    .all()) {
    const row = z.object({ target_json: z.string(), authorization_id: z.string() }).parse(value)
    const target = z.object({ budgetId: z.string().optional() }).parse(JSON.parse(row.target_json))
    if (
      target.budgetId &&
      !sqlite
        .prepare(
          "SELECT 1 FROM live_study_budget_members m JOIN live_study_budgets b ON b.id=m.budget_id JOIN live_study_budget_approvals a ON a.authorization_id=m.authorization_id WHERE m.authorization_id=? AND m.budget_id=? AND b.kind='restored'",
        )
        .get(row.authorization_id, target.budgetId)
    )
      throw new BackupError("shared guard cannot be restored without ledger and approval")
  }
}
