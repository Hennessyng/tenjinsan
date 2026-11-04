import Database from "better-sqlite3"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { captureLibrary, restoreLibrary } from "../src/backup.ts"
import { deleteLibraryItem } from "../src/library-deletion.ts"
import { openStorage } from "../src/storage.ts"
import { cleanupLibraries, library } from "./backup-fixture.ts"
import { guardNow } from "./live-study-fixture.ts"
import { sharedBudgetFixture } from "./shared-budget-fixture.ts"

const resources: ReturnType<typeof sharedBudgetFixture>[] = []
afterEach(() => {
  for (const item of resources.splice(0)) item.fixture.close()
  cleanupLibraries()
})

it("blocks an upgraded owner's sends, arming and claims until all migration guards are adopted", () => {
  // Given: reconstruct a disposable schema17 image, retaining its guarded spent history.
  const item = sharedBudgetFixture()
  resources.push(item)
  item.fixture.queue("old", 1)
  const before = item.history()
  const db = new Database(item.fixture.options.databasePath)
  const tables = [
    "full_book_recovery_uses",
    "full_book_recoveries",
    "full_book_not_needed",
    "full_book_managed_failures",
    "full_book_managed_threads",
    "full_book_managed_frames",
    "full_book_managed_revocations",
    "full_book_managed_consents",
    "full_book_imports",
    "full_book_reply_metadata",
    "full_book_attempt_events",
    "full_book_output_receipts",
    "full_book_wires",
    "full_book_jobs",
    "full_book_consent_closures",
    "full_book_consents",
    "live_study_adoption_barriers",
    "live_study_budget_approvals",
    "live_study_retirements",
    "live_study_budget_members",
    "live_study_budgets",
  ]
  try {
    const triggers = z
      .array(z.object({ name: z.string(), tbl_name: z.string() }))
      .parse(db.prepare("SELECT name,tbl_name FROM sqlite_master WHERE type='trigger'").all())
    for (const trigger of triggers)
      if (
        tables.includes(trigger.tbl_name) ||
        /^(shared_budget_|shared_adoption_|full_book_|recovery_)/.test(trigger.name)
      )
        db.exec(`DROP TRIGGER "${trigger.name}"`)
    for (const view of [
      "full_book_unresolved_sources",
      "full_book_source_commitments",
      "full_book_active_consents",
      "live_study_effective_admission",
      "live_study_scope_jobs",
      "live_study_pending_adoption",
    ])
      db.exec(`DROP VIEW IF EXISTS ${view}`)
    for (const table of tables) db.exec(`DROP TABLE IF EXISTS ${table}`)
    expect(
      db.prepare("DELETE FROM __drizzle_migrations WHERE created_at>=1791048438982").run().changes,
    ).toBe(7)
  } finally {
    db.close()
  }
  // When
  const upgraded = item.fixture.reopen()
  // Then
  expect(() => upgraded.liveStudyGuard.assertActive("setup-live")).toThrow("adoption-required")
  expect(() => upgraded.liveStudyGuard.assertActive("setup-old")).toThrow("adoption-required")
  expect(upgraded.liveStudyGuard.includes("setup-old")).toBe(false)
  expect(
    upgraded.execution.claimNextJob({
      token: "upgrade-window",
      now: guardNow,
      expiresAt: "2026-01-01T02:00:00Z",
    }),
  ).toBeNull()
  expect(() => item.fixture.reopen(item.fixture.target)).toThrow("adoption-required")
  expect(() =>
    deleteLibraryItem(item.fixture.options, { kind: "project", id: "study-live" }),
  ).toThrow("adoption")
  const guarded = new Database(item.fixture.options.databasePath)
  try {
    expect(() => guarded.prepare("UPDATE jobs SET state='running' WHERE id='old-0'").run()).toThrow(
      "adoption",
    )
    expect(() =>
      guarded
        .prepare(
          "INSERT INTO external_attempts (id,run_id,input_revision_id,state,reservation,record_json) SELECT 'blocked-attempt',id,input_revision_id,'prepared',1,'{}' FROM generation_runs WHERE id='old-0'",
        )
        .run(),
    ).toThrow("adoption")
    expect(() => guarded.prepare("DELETE FROM live_study_adoption_barriers").run()).toThrow(
      "immutable",
    )
    expect(() => guarded.prepare("DELETE FROM jobs WHERE id='old-0'").run()).toThrow("adoption")
    expect(() =>
      guarded.prepare("DELETE FROM external_attempts WHERE run_id='live-0'").run(),
    ).toThrow("adoption")
  } finally {
    guarded.close()
  }
  expect(item.history()).toBe(before)
  expect(upgraded.liveStudyBudget.adopt(item.adoption)).toMatchObject({ used: 3, remaining: 17 })
  expect(() => upgraded.liveStudyGuard.assertActive("setup-live")).toThrow("retired")
  expect(() => upgraded.liveStudyGuard.assertActive("setup-old")).not.toThrow()
  expect(upgraded.liveStudyGuard.limit("setup-old")).toBe(64)
  expect(item.history()).toBe(before)
  const archive = captureLibrary(item.fixture.options)
  expect(archive.toString()).not.toContain('"owner_id":"owner-1"')
  const destination = library("restored-owner")
  restoreLibrary(destination, archive)
  const restored = openStorage(destination)
  try {
    expect(restored.liveStudyBudget.status(item.adoption.id)).toMatchObject({
      used: 3,
      kind: "restored",
    })
    expect(() => restored.liveStudyGuard.assertActive("setup-live")).toThrow("budget-restored")
    expect(() => restored.liveStudyGuard.assertActive("setup-old")).not.toThrow()
  } finally {
    restored.close()
  }
})
