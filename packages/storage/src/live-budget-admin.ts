import { contentDigest, Digest, OwnerId } from "@reading-studio/contracts"
import type Database from "better-sqlite3"
import { z } from "zod"
import { fullBookSourceCommitments } from "./full-book-source-accounting.ts"
import { assertOwnerAdopted } from "./live-adoption-barrier.ts"
import { BudgetRow, budgetSetup, budgetStatus, scopeReservations } from "./live-budget-state.ts"
import { LiveStudyGuardError, LiveStudyTarget } from "./live-study-contract.ts"
import { liveStudyCount } from "./live-study-count.ts"

const Adoption = z.strictObject({
  id: z.uuid(),
  ownerId: OwnerId,
  sourceHash: Digest,
  members: z
    .array(
      z.strictObject({
        authorizationId: z.uuid(),
        expectedSpent: z.number().int().min(0).max(20),
        setupHash: Digest,
      }),
    )
    .min(1),
  reason: z.string().trim().min(8).max(500),
})
const Approval = z.strictObject({ ownerId: OwnerId, target: LiveStudyTarget })
export class LiveStudyBudget {
  constructor(private readonly sqlite: Database.Database) {}
  analysisAllowance(ownerId: string, sourceHash: string): number {
    assertOwnerAdopted(this.sqlite, ownerId)
    const row = this.sqlite
      .prepare("SELECT id FROM live_study_budgets WHERE owner_id=? AND source_hash=?")
      .get(ownerId, sourceHash)
    let remaining = 20
    if (row) {
      const value = budgetStatus(this.sqlite, z.object({ id: z.string() }).parse(row).id)
      if (value.kind !== "live") throw new LiveStudyGuardError("budget-restored")
      remaining = value.remaining
    } else {
      const prior = this.sqlite
        .prepare(
          "SELECT 1 FROM live_study_guards g JOIN studies st ON st.id=g.study_id JOIN setup_revisions s ON s.id=g.setup_revision_id WHERE st.owner_id=? AND json_extract(s.record_json,'$.analysis.editionHash')=? LIMIT 1",
        )
        .get(ownerId, sourceHash)
      if (prior) throw new LiveStudyGuardError("adoption-required")
    }
    if (
      this.sqlite
        .prepare(
          "SELECT 1 FROM full_book_consents WHERE owner_id=? AND source_hash=? UNION ALL SELECT 1 FROM full_book_imports WHERE owner_id=? AND source_hash=? LIMIT 1",
        )
        .get(ownerId, sourceHash, ownerId, sourceHash)
    ) {
      const projected = fullBookSourceCommitments(this.sqlite, ownerId, sourceHash)
      if (
        projected.held > 0 ||
        this.sqlite
          .prepare("SELECT 1 FROM full_book_unresolved_sources WHERE owner_id=? AND source_hash=?")
          .get(ownerId, sourceHash)
      )
        return 0
      return Math.max(0, 20 - projected.spent)
    }
    return remaining
  }
  status(id: string) {
    return this.sqlite.transaction(() => budgetStatus(this.sqlite, id))()
  }
  adopt(input: unknown) {
    const request = Adoption.parse(input)
    return this.sqlite
      .transaction(() => {
        const existing = this.sqlite
          .prepare("SELECT * FROM live_study_budgets WHERE id=? OR (owner_id=? AND source_hash=?)")
          .get(request.id, request.ownerId, request.sourceHash)
        if (existing) {
          const group = BudgetRow.parse(existing)
          if (group.kind !== "live" || group.adoption_json !== JSON.stringify(request))
            throw new LiveStudyGuardError("budget-mismatch")
          return budgetStatus(this.sqlite, group.id)
        }
        const guards = z
          .array(
            z.object({
              authorization_id: z.string(),
              setup_revision_id: z.string(),
              study_id: z.string(),
              setup_hash: z.string(),
              reserved_calls: z.number(),
            }),
          )
          .parse(
            this.sqlite
              .prepare(
                `SELECT g.* FROM live_study_guards g JOIN studies s ON s.id=g.study_id JOIN setup_revisions r ON r.id=g.setup_revision_id WHERE s.owner_id=? AND json_extract(r.record_json,'$.analysis.editionHash')=?`,
              )
              .all(request.ownerId, request.sourceHash),
          )
        if (
          guards.length !== request.members.length ||
          new Set(request.members.map((item) => item.authorizationId)).size !== guards.length
        )
          throw new LiveStudyGuardError("budget-mismatch")
        let spent = 0
        for (const guard of guards) {
          const member = request.members.find(
            (item) => item.authorizationId === guard.authorization_id,
          )
          const { setup, ownerId } = budgetSetup(this.sqlite, guard.setup_revision_id)
          const count = liveStudyCount({ sqlite: this.sqlite }, guard.study_id)
          if (
            !member ||
            ownerId !== request.ownerId ||
            member.setupHash !== guard.setup_hash ||
            member.setupHash !== contentDigest(JSON.stringify(setup)) ||
            count !== member.expectedSpent ||
            count !== guard.reserved_calls
          )
            throw new LiveStudyGuardError("counter-unknown")
          if (
            this.sqlite
              .prepare(
                `SELECT 1 FROM jobs WHERE setup_revision_id=? AND state IN ('running','queued') UNION ALL SELECT 1 FROM external_attempts WHERE state IN ('prepared','dispatching','outcome_unknown') AND run_id IN (SELECT run_id FROM jobs WHERE setup_revision_id=?) LIMIT 1`,
              )
              .get(setup.id, setup.id)
          )
            throw new LiveStudyGuardError("work-in-flight")
          spent += count
        }
        if (
          !guards.length ||
          spent > 20 ||
          spent !== scopeReservations(this.sqlite, request.ownerId, request.sourceHash)
        )
          throw new LiveStudyGuardError("counter-unknown")
        if (
          this.sqlite
            .prepare(
              "SELECT 1 FROM live_study_scope_jobs WHERE owner_id=? AND source_hash=? AND state IN ('queued','running') LIMIT 1",
            )
            .get(request.ownerId, request.sourceHash)
        )
          throw new LiveStudyGuardError("work-in-flight")
        this.sqlite
          .prepare("INSERT INTO live_study_budgets VALUES (?,?,?,20,?,'live',?)")
          .run(request.id, request.ownerId, request.sourceHash, spent, JSON.stringify(request))
        for (const guard of guards) {
          this.sqlite
            .prepare("INSERT INTO live_study_budget_members VALUES (?,?)")
            .run(guard.authorization_id, request.id)
          this.sqlite
            .prepare("INSERT INTO live_study_retirements VALUES (?,?,?)")
            .run(guard.authorization_id, request.id, request.reason)
        }
        return budgetStatus(this.sqlite, request.id)
      })
      .immediate()
  }
  approve(input: unknown) {
    const { ownerId, target } = Approval.parse(input)
    return this.sqlite
      .transaction(() => {
        if (!target.budgetId || !target.attemptLimit)
          throw new LiveStudyGuardError("budget-mismatch")
        const group = BudgetRow.parse(
          this.sqlite.prepare("SELECT * FROM live_study_budgets WHERE id=?").get(target.budgetId),
        )
        const status = budgetStatus(this.sqlite, group.id)
        const { setup, ownerId: actualOwner } = budgetSetup(this.sqlite, target.setupRevisionId)
        if (
          this.sqlite
            .prepare(
              "SELECT 1 FROM live_study_guards WHERE authorization_id=? OR study_id=? OR setup_revision_id=?",
            )
            .get(target.authorizationId, target.studyId, target.setupRevisionId)
        )
          throw new LiveStudyGuardError("history-not-fresh")
        if (
          group.kind !== "live" ||
          group.owner_id !== ownerId ||
          actualOwner !== ownerId ||
          group.source_hash !== target.sourceHash ||
          setup.studyId !== target.studyId ||
          setup.analysis.editionHash !== target.sourceHash ||
          setup.analysis.model !== target.model ||
          setup.analysis.provider !== "chatgpt-subscription" ||
          setup.analysis.destination?.executionPolicy !== "tool-managed-v1" ||
          JSON.stringify(setup.analysis.purpose) !== JSON.stringify(target.purpose) ||
          target.attemptLimit !== status.remaining
        )
          throw new LiveStudyGuardError("budget-mismatch")
        if (
          !this.sqlite
            .prepare("SELECT 1 FROM installations WHERE id=? AND owner_id=?")
            .get(setup.analysis.destination.installationId, ownerId)
        )
          throw new LiveStudyGuardError("budget-mismatch")
        if (
          this.sqlite
            .prepare(
              `SELECT 1 FROM live_study_budget_members m WHERE m.budget_id=? AND NOT EXISTS(SELECT 1 FROM live_study_retirements r WHERE r.authorization_id=m.authorization_id) UNION ALL SELECT 1 FROM live_study_budget_approvals a WHERE a.budget_id=? LIMIT 1`,
            )
            .get(group.id, group.id)
        )
          throw new LiveStudyGuardError("budget-mismatch")
        const count = z
          .object({ setups: z.literal(1), jobs: z.literal(0), grants: z.literal(0) })
          .safeParse(
            this.sqlite
              .prepare(
                `SELECT (SELECT COUNT(*) FROM setup_revisions WHERE study_id=?) AS setups,(SELECT COUNT(*) FROM jobs WHERE setup_revision_id=?) AS jobs,(SELECT COUNT(*) FROM transmission_grants WHERE setup_revision_id=?) AS grants`,
              )
              .get(setup.studyId, setup.id, setup.id),
          )
        if (!count.success) throw new LiveStudyGuardError("history-not-fresh")
        this.sqlite
          .prepare("INSERT INTO live_study_budget_approvals VALUES (?,?,?,?,?,?,?)")
          .run(
            target.authorizationId,
            group.id,
            setup.studyId,
            setup.id,
            JSON.stringify(target),
            contentDigest(JSON.stringify(setup)),
            target.attemptLimit,
          )
        return target
      })
      .immediate()
  }
}
