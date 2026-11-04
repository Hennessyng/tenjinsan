import {
  contentDigest,
  ExternalAttempt,
  FullBookTestConsent,
  GenerationRun,
  NormalizationRevision,
  NormalizedStudySetup,
  RunAttempts,
  restoreFullBookTest,
  StudySetupRevision,
  sameSubscriptionDestination,
  wholeBookScope,
} from "@reading-studio/contracts"
import { safeRecord } from "./backup-sanitize.ts"
import { BackupError, type Payload, parseRow, tableNamed } from "./backup-schema.ts"
import { FullBookReplyMetadata, FullBookWire } from "./full-book-execution-contract.ts"
import { fullBookJobId } from "./full-book-execution-history.ts"
import { FullBookJobRow } from "./full-book-execution-store.ts"
import { checkFullBookWire } from "./full-book-execution-wire.ts"
import { auditReplyCoordinates } from "./full-book-managed-audit.ts"
import { validateAuditEvents } from "./full-book-portable-events.ts"
import type { FullBookAudit, FullBookImport } from "./full-book-portable-schema.ts"
import { portableFullBookReceipts } from "./full-book-portable-unused.ts"

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

import {
  portableOne as one,
  portableRows as rows,
  portableText as text,
} from "./full-book-portable-rows.ts"
export function validateFullBookAudit(
  audit: FullBookAudit,
  meta: FullBookImport,
  payload: Payload,
) {
  const consent = FullBookTestConsent.parse(JSON.parse(text(audit.consent, "record_json"))),
    session = consent.session
  const setup = StudySetupRevision.parse(JSON.parse(audit.setupJson))
  const archivedSetup = StudySetupRevision.parse(
    JSON.parse(text(one(rows(payload, "setup_revisions"), "id", setup.id), "record_json")),
  )
  const normalization = NormalizationRevision.parse(
    JSON.parse(
      text(
        one(rows(payload, "normalization_revisions"), "id", session.input.normalization.id),
        "record_json",
      ),
    ),
  )
  const study = one(rows(payload, "studies"), "id", consent.studyId)
  NormalizedStudySetup.parse({ setup, normalization })
  const destination = archivedSetup.analysis.destination,
    originalDestination = session.destination
  if (
    !destination ||
    destination.provider !== originalDestination.provider ||
    destination.billingRoute !== originalDestination.billingRoute ||
    destination.executionPolicy !== originalDestination.executionPolicy ||
    destination.identityBinding !== originalDestination.identityBinding ||
    consent.sourceCeiling < session.plan.maxAttempts
  )
    throw new BackupError("experimental historical policy binding")
  if (
    !equal(normalization, session.input.normalization) ||
    setup.id !== consent.setupRevisionId ||
    setup.studyId !== consent.studyId ||
    audit.study["id"] !== study["id"] ||
    audit.study["edition_id"] !== study["edition_id"] ||
    audit.study["owner_id"] !== consent.ownerId ||
    setup.analysis.model !== session.model ||
    !equal(setup.analysis.settings, session.settings) ||
    !sameSubscriptionDestination(setup.analysis.destination, session.destination) ||
    !equal(setup.analysis.scope, wholeBookScope(normalization)) ||
    consent.acknowledgement.coverage !== normalization.coverage ||
    !equal(consent.acknowledgement.omissions, normalization.omissions ?? []) ||
    !equal(
      {
        ...setup,
        analysis: { ...setup.analysis, destination: archivedSetup.analysis.destination },
      },
      archivedSetup,
    )
  )
    throw new BackupError("experimental authoritative source/setup binding")
  if (
    audit.consent["id"] !== consent.id ||
    audit.consent["owner_id"] !== consent.ownerId ||
    audit.consent["study_id"] !== consent.studyId ||
    audit.consent["setup_revision_id"] !== setup.id ||
    audit.consent["setup_hash"] !== contentDigest(JSON.stringify(setup)) ||
    audit.consent["source_hash"] !== normalization.editionHash ||
    audit.consent["ceiling"] !== consent.sourceCeiling ||
    audit.consent["held_calls"] !== session.plan.maxAttempts ||
    audit.closure["consent_id"] !== consent.id ||
    !text(audit.closure, "reason").trim()
  )
    throw new BackupError("experimental consent counter/closure binding")
  if (
    meta.consentId !== consent.id ||
    meta.sourceHash !== normalization.editionHash ||
    meta.studyId !== consent.studyId ||
    meta.setupRevisionId !== setup.id ||
    meta.budgetVersion !== audit.consent["budget_version"] ||
    meta.originalReservedCalls !== session.plan.maxAttempts ||
    !equal(
      meta.runIds,
      audit.runs.map((row) => row["id"]),
    ) ||
    !equal(
      meta.attemptIds,
      audit.attempts.map((row) => row["id"]),
    )
  )
    throw new BackupError("experimental historical index binding")
  if (audit.jobs.length && audit.jobs.length !== session.plan.nodes.length)
    throw new BackupError("experimental graph incomplete")
  if (
    audit.runs.length !== audit.jobs.length ||
    audit.wires.length !== audit.attempts.length ||
    new Set(audit.wires.map((row) => row["attempt_id"])).size !== audit.wires.length
  )
    throw new BackupError("experimental counters or wire manifest incomplete")
  const { receipts, local, localTargets } = portableFullBookReceipts(audit, consent)
  restoreFullBookTest(session, receipts)
  const attempts: ExternalAttempt[] = [],
    turns = new Set<string>()
  for (const [index, raw] of audit.jobs.entries()) {
    const job = FullBookJobRow.parse(raw)
    if (
      job.id !== fullBookJobId(consent, index) ||
      job.consent_id !== consent.id ||
      job.node_index !== index ||
      job.run_id !== `fb-${job.id}` ||
      job.state === "running" ||
      job.token !== null ||
      job.expires_at !== null ||
      (job.state === "completed") !== (index < receipts.length || local.has(index))
    )
      throw new BackupError("experimental historical job binding")
    const originalRun = one(audit.runs, "id", job.run_id),
      run = GenerationRun.parse(JSON.parse(text(originalRun, "record_json")))
    parseRow(tableNamed("generation_runs"), originalRun)
    if (
      run.id !== job.run_id ||
      run.inputRevisionId !== `fb-input-${consent.id}` ||
      run.budget.maxCalls !== 2 ||
      run.state === "running" ||
      !equal(
        safeRecord("generation_runs", originalRun),
        one(rows(payload, "generation_runs"), "id", run.id),
      )
    )
      throw new BackupError("experimental run/counter projection")
    const jobAttempts = audit.attempts
      .filter((row) => row["run_id"] === run.id)
      .map((row) => {
        parseRow(tableNamed("external_attempts"), row)
        if (!equal(row, one(rows(payload, "external_attempts"), "id", text(row, "id"))))
          throw new BackupError("experimental charged attempt projection")
        const attempt = ExternalAttempt.parse(JSON.parse(text(row, "record_json")))
        if (
          attempt.state === "prepared" ||
          attempt.state === "dispatching" ||
          (attempt.state === "outcome_unknown" && attempt.resolution === "awaiting-owner")
        )
          throw new BackupError("experimental unresolved attempt is not portable")
        const wireRow = one(audit.wires, "attempt_id", attempt.id),
          wire = FullBookWire.parse(JSON.parse(text(wireRow, "record_json")))
        if (
          index > receipts.length ||
          wireRow["job_id"] !== job.id ||
          wireRow["ordinal"] !== attempt.reservation ||
          wire.jobId !== job.id ||
          wire.attemptId !== attempt.id ||
          wire.ordinal !== attempt.reservation ||
          wire.leaseFence > job.fence ||
          wire.targetHash !== job.target_hash
        )
          throw new BackupError("experimental historical wire identity")
        checkFullBookWire(consent, receipts.slice(0, index), wire)
        if (attempt.state === "response-received") {
          const blob = payload.blobs.find((blob) => blob.hash === attempt.responseHash)
          if (
            !blob ||
            contentDigest(Buffer.from(blob.bytes, "base64").toString("utf8")) !==
              attempt.responseHash
          )
            throw new BackupError("experimental reply bytes missing")
          const reply = FullBookReplyMetadata.parse(
            JSON.parse(text(one(audit.replies, "attempt_id", attempt.id), "record_json")),
          )
          const turn = JSON.stringify([reply.threadId, reply.turnId])
          const coordinates = auditReplyCoordinates(audit, wire)
          if (
            turns.has(turn) ||
            reply.transport !== coordinates.transport ||
            reply.threadId !== coordinates.threadId ||
            reply.requestId !== coordinates.requestId ||
            reply.targetHash !== coordinates.targetHash ||
            reply.wireHash !== coordinates.wireHash
          )
            throw new BackupError("experimental reply transport binding")
          turns.add(turn)
        }
        return attempt
      })
    RunAttempts.parse({ run, attempts: jobAttempts })
    attempts.push(...jobAttempts)
    if (local.has(index)) {
      if (
        jobAttempts.length ||
        run.reservedCalls !== 0 ||
        job.target_hash !== localTargets.get(index)
      )
        throw new BackupError("unused job has charged attempts or foreign binding")
    } else if (index < receipts.length) {
      const accepted = one(audit.receipts, "job_id", job.id),
        attempt = jobAttempts.find((attempt) => attempt.id === accepted["attempt_id"])
      const receipt = receipts[index]
      if (
        !receipt ||
        attempt?.state !== "response-received" ||
        attempt.responseHash !== receipt.outputHash ||
        payload.blobs.find((blob) => blob.hash === receipt.outputHash)?.bytes !==
          Buffer.from(receipt.serialized).toString("base64")
      )
        throw new BackupError("experimental accepted body/child hash")
      const reply = FullBookReplyMetadata.parse(
        JSON.parse(text(one(audit.replies, "attempt_id", attempt.id), "record_json")),
      )
      if (reply.terminal !== "completed")
        throw new BackupError("experimental accepted nonterminal reply")
    }
  }
  if (
    attempts.length !== audit.attempts.length ||
    audit.replies.length !==
      attempts.filter((attempt) => attempt.state === "response-received").length ||
    attempts.length !== meta.spent
  )
    throw new BackupError("experimental history counts")
  validateAuditEvents(audit.events, attempts)
}
