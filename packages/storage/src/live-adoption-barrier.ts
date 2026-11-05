import type Database from "better-sqlite3"
import { LiveStudyGuardError } from "./live-study-contract.ts"

export function assertOwnerAdopted(sqlite: Database.Database, ownerId: string): void {
  if (sqlite.prepare("SELECT 1 FROM live_study_pending_adoption WHERE owner_id=?").get(ownerId))
    throw new LiveStudyGuardError("adoption-required")
}
export function setupAdoptionPending(sqlite: Database.Database, setupId: string): boolean {
  return (
    sqlite
      .prepare(
        "SELECT 1 FROM setup_revisions s JOIN studies st ON st.id=s.study_id JOIN live_study_pending_adoption p ON p.owner_id=st.owner_id WHERE s.id=?",
      )
      .get(setupId) !== undefined
  )
}
