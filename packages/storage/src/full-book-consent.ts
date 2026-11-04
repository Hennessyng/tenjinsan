import {
  Digest,
  FullBookConsentError,
  FullBookTestConsent,
  OwnerId,
} from "@reading-studio/contracts"
import { z } from "zod"
import type { StorageContext } from "./database.ts"
import { fullBookConsentAuthority } from "./full-book-consent-authority.ts"
import { fullBookSourcePreview } from "./full-book-preview.ts"
import { fullBookSourceCommitments } from "./full-book-source-accounting.ts"
import { assertOwnerAdopted } from "./live-adoption-barrier.ts"
import { scopeReservations } from "./live-budget-state.ts"
import type { SourceRepository } from "./sources.ts"

export class FullBookConsentRepository {
  constructor(
    private readonly context: StorageContext,
    private readonly sources: SourceRepository,
  ) {}

  approve(value: unknown): Readonly<{
    consent: FullBookTestConsent
    budgetVersion: number
    spent: number
    held: number
  }> {
    const consent = FullBookTestConsent.parse(value),
      sqlite = this.context.sqlite
    return sqlite
      .transaction(() => {
        const setupHash = fullBookConsentAuthority(this.context, this.sources, consent)
        assertOwnerAdopted(sqlite, consent.ownerId)
        const sourceHash = consent.session.input.normalization.editionHash
        scopeReservations(sqlite, consent.ownerId, sourceHash)
        const { spent } = fullBookSourceCommitments(sqlite, consent.ownerId, sourceHash)
        if (
          sqlite
            .prepare("SELECT 1 FROM full_book_active_consents WHERE owner_id=? AND source_hash=?")
            .get(consent.ownerId, sourceHash)
        )
          throw new FullBookConsentError("active")
        if (
          sqlite
            .prepare(`SELECT 1 FROM live_study_scope_jobs j LEFT JOIN external_attempts a ON a.run_id=j.run_id
        WHERE j.owner_id=? AND j.source_hash=? AND (j.state='running' OR
        (a.state IN ('prepared','dispatching','outcome_unknown') AND j.state!='cancelled')) LIMIT 1`)
            .get(consent.ownerId, sourceHash)
        )
          throw new FullBookConsentError("inflight")
        const held = consent.session.plan.maxAttempts
        if (spent + held > consent.sourceCeiling) throw new FullBookConsentError("budget")
        const { version } = z
          .object({ version: z.number().int().positive() })
          .parse(
            sqlite
              .prepare(
                "SELECT COALESCE(MAX(v),0)+1 AS version FROM (SELECT budget_version AS v FROM full_book_consents WHERE owner_id=? AND source_hash=? UNION ALL SELECT budget_version AS v FROM full_book_imports WHERE owner_id=? AND source_hash=?)",
              )
              .get(consent.ownerId, sourceHash, consent.ownerId, sourceHash),
          )
        sqlite
          .prepare("INSERT INTO full_book_consents VALUES (?,?,?,?,?,?,?,?,?,?)")
          .run(
            consent.id,
            consent.ownerId,
            consent.studyId,
            consent.setupRevisionId,
            sourceHash,
            version,
            consent.sourceCeiling,
            held,
            setupHash,
            JSON.stringify(consent),
          )
        return Object.freeze({ consent, budgetVersion: version, spent, held })
      })
      .immediate()
  }

  read(id: string): FullBookTestConsent {
    return this.readRecord(id, true)
  }
  historical(id: string): FullBookTestConsent {
    return this.readRecord(id, false)
  }
  private readRecord(id: string, active: boolean): FullBookTestConsent {
    return this.context.sqlite.transaction(() => {
      const row = z
        .object({ record_json: z.string(), setup_hash: z.string() })
        .parse(
          this.context.sqlite
            .prepare("SELECT record_json,setup_hash FROM full_book_consents WHERE id=?")
            .get(id),
        )
      if (
        active &&
        this.context.sqlite
          .prepare("SELECT 1 FROM full_book_consent_closures WHERE consent_id=?")
          .get(id)
      )
        throw new FullBookConsentError("closed")
      const consent = FullBookTestConsent.parse(JSON.parse(row.record_json))
      if (
        consent.id !== id ||
        fullBookConsentAuthority(this.context, this.sources, consent) !== row.setup_hash
      )
        throw new FullBookConsentError("authority")
      return consent
    })()
  }

  close(id: string, reason: string): void {
    const parsed = z.string().trim().min(1).max(2000).parse(reason)
    this.context.sqlite
      .transaction(() => {
        this.context.sqlite
          .prepare("INSERT INTO full_book_consent_closures VALUES (?,?)")
          .run(id, parsed)
      })
      .immediate()
  }

  commitments(owner: string, hash: string) {
    const ownerId = OwnerId.parse(owner),
      sourceHash = Digest.parse(hash)
    return this.context.sqlite.transaction(() => {
      scopeReservations(this.context.sqlite, ownerId, sourceHash)
      return fullBookSourceCommitments(this.context.sqlite, ownerId, sourceHash)
    })()
  }
  preview(owner: string, hash: string) {
    return this.context.sqlite.transaction(() =>
      fullBookSourcePreview(this.context.sqlite, OwnerId.parse(owner), Digest.parse(hash)),
    )()
  }
  isCurrentSource(editionId: string, normalizationId: string) {
    const row = this.context.sqlite
      .prepare(
        "SELECT id FROM normalization_revisions WHERE edition_id=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(editionId)
    return z.object({ id: z.string() }).safeParse(row).data?.id === normalizationId
  }
}
