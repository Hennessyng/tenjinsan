import { contentDigest, Job, StudySetupRevision } from "@reading-studio/contracts"
import { z } from "zod"
import { enrollFreshAnalysisBudget } from "./analysis-purpose-enrollment.ts"
import { requireAnalysisPurposeJob } from "./analysis-purpose-job.ts"
import type { StorageContext } from "./database.ts"
import { assertOwnerAdopted } from "./live-adoption-barrier.ts"
import { BudgetRow, budgetAdmission, budgetSetup, budgetStatus } from "./live-budget-state.ts"
import {
  liveStudyClaimFilter,
  liveStudyIncludes,
  requirePurposeTarget,
} from "./live-study-admission.ts"
import { LiveStudyGuardError, LiveStudyTarget } from "./live-study-contract.ts"
import { liveStudyCount } from "./live-study-count.ts"

const Row = z.object({
  target_json: z.string(),
  setup_hash: z.string(),
  attempt_limit: z.literal(20),
  reserved_calls: z.number().int().min(0).max(20),
})
export class LiveStudyGuard {
  readonly target: LiveStudyTarget | undefined
  constructor(
    private readonly context: Pick<StorageContext, "sqlite">,
    input?: unknown,
  ) {
    this.target = input === undefined ? undefined : LiveStudyTarget.parse(input)
    const target = this.target
    if (!target) return
    context.sqlite
      .transaction(() => {
        const setup = this.setup(target.setupRevisionId)
        const { ownerId } = budgetSetup(context.sqlite, setup.id)
        assertOwnerAdopted(context.sqlite, ownerId)
        const ownerBudgetExists =
          context.sqlite
            .prepare("SELECT 1 FROM live_study_budgets WHERE owner_id=?")
            .get(ownerId) !== undefined
        const groupValue = context.sqlite
          .prepare("SELECT * FROM live_study_budgets WHERE owner_id=? AND source_hash=?")
          .get(ownerId, target.sourceHash)
        if (
          setup.studyId !== target.studyId ||
          setup.analysis.provider !== "chatgpt-subscription" ||
          setup.analysis.model !== target.model ||
          setup.analysis.editionHash !== target.sourceHash ||
          setup.analysis.destination?.billingRoute !== "subscription-provider-managed" ||
          setup.analysis.destination.executionPolicy !== "tool-managed-v1"
        )
          throw new LiveStudyGuardError("target-mismatch")
        if (
          JSON.stringify(setup.analysis.purpose) !== JSON.stringify(target.purpose) ||
          (setup.analysis.purpose && !setup.batchedVerificationReserve)
        )
          throw new LiveStudyGuardError("target-mismatch")
        const existing = context.sqlite
          .prepare(
            "SELECT * FROM live_study_guards WHERE authorization_id=? OR study_id=? OR setup_revision_id=?",
          )
          .get(target.authorizationId, target.studyId, target.setupRevisionId)
        if (existing) {
          this.validate(existing, setup)
          budgetAdmission(context.sqlite, setup.id)
          if (ownerBudgetExists && !target.budgetId)
            throw new LiveStudyGuardError("budget-mismatch")
          return
        }
        if (ownerBudgetExists && !target.budgetId) throw new LiveStudyGuardError("budget-mismatch")
        const freshAnalysisBudget = setup.analysis.purpose && !groupValue
        if (freshAnalysisBudget) enrollFreshAnalysisBudget(context.sqlite, setup, target, ownerId)
        if (groupValue) {
          const group = BudgetRow.parse(groupValue)
          const approved = context.sqlite
            .prepare(
              "SELECT target_json,setup_hash FROM live_study_budget_approvals WHERE authorization_id=? AND budget_id=?",
            )
            .get(target.authorizationId, group.id)
          const binding = z
            .object({ target_json: z.string(), setup_hash: z.string() })
            .safeParse(approved)
          if (
            group.kind !== "live" ||
            target.budgetId !== group.id ||
            !binding.success ||
            binding.data.target_json !== JSON.stringify(target) ||
            binding.data.setup_hash !== contentDigest(JSON.stringify(setup)) ||
            target.attemptLimit !== budgetStatus(context.sqlite, group.id).remaining
          )
            throw new LiveStudyGuardError("budget-mismatch")
        } else if (target.budgetId !== undefined && !freshAnalysisBudget)
          throw new LiveStudyGuardError("budget-mismatch")
        const fresh = z
          .object({
            setups: z.literal(1),
            jobs: z.literal(0),
            grants: z.literal(0),
            interviews: z.literal(0),
          })
          .safeParse(
            context.sqlite
              .prepare(`SELECT
        (SELECT COUNT(*) FROM setup_revisions WHERE study_id=?) AS setups,
        (SELECT COUNT(*) FROM jobs j JOIN setup_revisions s ON s.id=j.setup_revision_id WHERE s.study_id=?) AS jobs,
        (SELECT COUNT(*) FROM transmission_grants g JOIN setup_revisions s ON s.id=g.setup_revision_id WHERE s.study_id=?) AS grants,
        (SELECT COUNT(*) FROM interview_definitions WHERE study_id=?) AS interviews`)
              .get(target.studyId, target.studyId, target.studyId, target.studyId),
          )
        if (!fresh.success) throw new LiveStudyGuardError("history-not-fresh")
        context.sqlite
          .prepare("INSERT INTO live_study_guards VALUES (?,?,?,?,?,20,0)")
          .run(
            target.authorizationId,
            target.studyId,
            target.setupRevisionId,
            JSON.stringify(target),
            contentDigest(JSON.stringify(setup)),
          )
        if (target.budgetId)
          context.sqlite
            .prepare("INSERT INTO live_study_budget_members VALUES (?,?)")
            .run(target.authorizationId, target.budgetId)
      })
      .immediate()
  }
  private setup(id: string): StudySetupRevision {
    const row = z
      .object({ record_json: z.string() })
      .safeParse(
        this.context.sqlite.prepare("SELECT record_json FROM setup_revisions WHERE id=?").get(id),
      )
    if (!row.success) throw new LiveStudyGuardError("target-mismatch")
    return StudySetupRevision.parse(JSON.parse(row.data.record_json))
  }
  private validate(value: unknown, setup: StudySetupRevision): z.infer<typeof Row> {
    const row = Row.safeParse(value)
    if (
      !row.success ||
      JSON.stringify(LiveStudyTarget.parse(JSON.parse(row.data.target_json))) !==
        JSON.stringify(this.target) ||
      row.data.setup_hash !== contentDigest(JSON.stringify(setup))
    )
      throw new LiveStudyGuardError("target-mismatch")
    const latest = z
      .object({ id: z.string() })
      .safeParse(
        this.context.sqlite
          .prepare("SELECT id FROM setup_revisions WHERE study_id=? ORDER BY rowid DESC LIMIT 1")
          .get(setup.studyId),
      )
    if (!latest.success || latest.data.id !== setup.id)
      throw new LiveStudyGuardError("target-mismatch")
    return row.data
  }
  used(): number {
    const target = this.target
    if (!target) throw new LiveStudyGuardError("explicit-target-required")
    return this.context.sqlite.transaction(() => {
      budgetAdmission(this.context.sqlite, target.setupRevisionId)
      const row = this.validate(
        this.context.sqlite
          .prepare("SELECT * FROM live_study_guards WHERE authorization_id=?")
          .get(target.authorizationId),
        this.setup(target.setupRevisionId),
      )
      const count = liveStudyCount(this.context, target.studyId)
      if (count !== row.reserved_calls) throw new LiveStudyGuardError("counter-unknown")
      return count
    })()
  }
  private requirePurposeTarget(setupId: string): void {
    requirePurposeTarget(this.context.sqlite, this.target, setupId)
  }
  assertJob(input: unknown, inserting = false): void {
    requireAnalysisPurposeJob(
      { sqlite: this.context.sqlite, liveStudyGuard: this },
      Job.parse(input),
      inserting,
    )
  }
  assertPurposeTargetOnly(setupId: string): void {
    this.requirePurposeTarget(setupId)
  }
  assertUnknownResolution(input: unknown): void {
    requireAnalysisPurposeJob(
      { sqlite: this.context.sqlite, liveStudyGuard: this },
      Job.parse(input),
      false,
      true,
    )
  }
  limit(setupId: string): number {
    this.requirePurposeTarget(setupId)
    const shared = budgetAdmission(this.context.sqlite, setupId)
    if (this.target) {
      if (setupId !== this.target.setupRevisionId) throw new LiveStudyGuardError("target-mismatch")
      const used = this.used()
      return shared ? Math.min(shared.targetLimit, used + shared.remaining) : 20
    }
    const guarded = this.context.sqlite
      .prepare(
        "SELECT 1 FROM live_study_guards g JOIN setup_revisions s ON s.study_id=g.study_id WHERE s.id=?",
      )
      .get(setupId)
    if (guarded) throw new LiveStudyGuardError("explicit-target-required")
    return 64
  }
  includes(setupId: string): boolean {
    return liveStudyIncludes(this.context.sqlite, this.target, setupId)
  }
  claimFilter() {
    return liveStudyClaimFilter(this.target)
  }
  assertActive(setupId: string): void {
    this.requirePurposeTarget(setupId)
    const shared = budgetAdmission(this.context.sqlite, setupId)
    if (shared && (this.target?.setupRevisionId !== setupId || this.target.budgetId !== shared.id))
      throw new LiveStudyGuardError("explicit-target-required")
  }
  sharedStatus(setupId: string) {
    const row = z
      .object({ budget_id: z.string(), retired: z.number() })
      .safeParse(
        this.context.sqlite
          .prepare("SELECT budget_id,retired FROM live_study_effective_admission WHERE setup_id=?")
          .get(setupId),
      )
    return row.success
      ? {
          ...budgetStatus(this.context.sqlite, row.data.budget_id),
          retired: row.data.retired === 1,
        }
      : null
  }
  recordReservation(setupId: string): void {
    if (!this.target) return
    if (setupId !== this.target.setupRevisionId) throw new LiveStudyGuardError("target-mismatch")
    const result = this.context.sqlite
      .prepare(
        "UPDATE live_study_guards SET reserved_calls=reserved_calls+1 WHERE authorization_id=? AND reserved_calls<20",
      )
      .run(this.target.authorizationId)
    if (result.changes !== 1) throw new LiveStudyGuardError("counter-unknown")
  }
}
