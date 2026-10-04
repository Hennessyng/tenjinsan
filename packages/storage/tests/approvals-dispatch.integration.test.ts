import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BriefDraft } from "@reading-studio/contracts"
import { afterEach, beforeEach, expect, it } from "vitest"
import { openStorage, type Storage } from "../src/index.ts"
import {
  approvalContent as content,
  approvalGraph as graph,
  seedApprovalStorage,
} from "./approval-fixture.ts"

let storage: Storage
let directory: string
let brief: BriefDraft
const lease = { jobId: "job-1", token: "lease", fence: 1, now: "2026-09-23T01:00:01Z" }
const attempt = { ...lease, attemptId: "attempt-1", preparedAt: lease.now }
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "brief-dispatch-"))
  storage = openStorage({
    databasePath: join(directory, "test.sqlite"),
    privateDataRoot: join(directory, "private"),
  })
  seedApprovalStorage(storage)
  brief = storage.briefs.save({ studyId: "study-1", expectedRevisionId: null, content })
  storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "approve" })
  storage.execution.appendRun({
    ...graph.run,
    inputRevisionId: brief.id,
    state: "running",
    reservedCalls: 0,
  })
  storage.execution.appendJob({ ...graph.job, stage: "outline", inputRevisionId: brief.id })
  storage.execution.claimNextJob({
    token: "lease",
    now: "2026-09-23T01:00:00Z",
    expiresAt: "2026-09-23T01:01:00Z",
  })
})
afterEach(() => {
  storage.close()
  rmSync(directory, { recursive: true, force: true })
})

it("blocks a new provider reservation when the approved brief changes", () => {
  // Given
  storage.briefs.save({ studyId: "study-1", expectedRevisionId: brief.id, content })
  // When / Then
  expect(() => storage.execution.reserveAttempt(attempt)).toThrow("brief approval")
  expect(storage.counts().attempts).toBe(0)
})

it("blocks dispatch when an already prepared attempt loses its approval", () => {
  // Given
  storage.execution.reserveAttempt(attempt)
  storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "revise" })
  // When / Then
  expect(() =>
    storage.execution.markAttemptDispatching({
      ...lease,
      attemptId: "attempt-1",
      dispatchedAt: lease.now,
    }),
  ).toThrow("brief approval")
  expect(storage.execution.getAttempt("attempt-1")?.state).toBe("prepared")
})

it("retains an in-flight provider receipt when the reader invalidates approval", () => {
  // Given
  storage.execution.reserveAttempt(attempt)
  storage.execution.markAttemptDispatching({
    ...lease,
    attemptId: "attempt-1",
    dispatchedAt: lease.now,
  })
  storage.briefs.decide({ studyId: "study-1", revisionId: brief.id, action: "revise" })
  // When
  const receipt = storage.execution.recordAttemptReceipt({
    ...lease,
    attemptId: "attempt-1",
    receivedAt: lease.now,
    responseBody: new TextEncoder().encode("receipt"),
    usage: { kind: "known", inputTokens: 9, outputTokens: 3 },
  })
  // Then
  expect(receipt).toMatchObject({
    state: "response-received",
    usage: { kind: "known", inputTokens: 9, outputTokens: 3 },
  })
})
