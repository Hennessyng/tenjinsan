import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { authorizeSource } from "@reading-studio/providers"
import { afterEach, expect, it, vi } from "vitest"
import {
  bookFixtureAuthority,
  bookFixtureTurns,
} from "../../apps/worker/tests/book-map-route-fixture.ts"
import { WholeBookAdapter, wholeBookWorker } from "../../apps/worker/tests/whole-book-fixture.ts"
import { corpus } from "./ten29/corpus-support.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { persistedCorpus } from "./ten29/persisted-corpus.ts"
import { processingSnapshot } from "./ten29/processing-evidence.ts"

const fixtures: Awaited<ReturnType<typeof persistedCorpus>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("records an actually interrupted map as dispatched and uncertain, never confirmed or unsent", async () => {
  // Given
  const family = corpus[0]
  if (!family) throw new TypeError("Missing frozen family")
  const fixture = await persistedCorpus(family, "epub")
  fixtures.push(fixture)
  const adapter = new WholeBookAdapter()
  const authored = adapter.dispatch.bind(adapter)
  vi.spyOn(adapter, "dispatch").mockImplementation(async (request) => {
    const receipt = await authored(request)
    if (receipt.kind !== "output") throw new TypeError("Expected authored map output")
    const output: unknown = JSON.parse(receipt.text)
    if (typeof output !== "object" || output === null) throw new TypeError("Missing authored map")
    return { ...receipt, text: JSON.stringify({ ...output, fixtureTransport: "incomplete" }) }
  })
  const { pipeline, worker } = wholeBookWorker(fixture, adapter)
  const initial = pipeline.prepare("setup-whole", "grant-whole")
  // When
  const result = await worker.runNext()
  const current = pipeline.prepare("setup-whole", "grant-whole")
  const part = current.wholeBook?.parts[0]
  const job = part && fixture.storage.execution.getJob(part.id)
  if (!job) throw new TypeError("Missing interrupted map job")
  const attempts = fixture.storage.execution.listAttempts(job.runId)
  const attempt = attempts[0]
  if (!attempt) throw new TypeError("Missing actual dispatch attempt")
  const native = bookFixtureTurns(fixture)
  const authorized = authorizeSource(bookFixtureAuthority(fixture), job)
  const evidence = await evidenceDirectory("map-unknown")
  await writeFile(
    join(evidence, "before-helper.json"),
    JSON.stringify(
      {
        initial,
        current,
        result,
        job,
        attempts,
        native,
        currentNormalizationId: authorized.normalization.id,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  )
  // Then
  expect(job).toMatchObject({
    state: "paused",
    reason: "outcome_unknown",
    usage: { kind: "unknown" },
  })
  expect(attempts).toMatchObject([
    { state: "outcome_unknown", resolution: "awaiting-owner", usage: { kind: "unknown" } },
  ])
  expect(fixture.storage.execution.getAttemptReceipt(attempt.id)).toBeNull()
  expect(fixture.storage.execution.getRun(job.runId)?.reservedCalls).toBe(1)
  expect(native).toHaveLength(1)
  expect(part?.status).toBe("uncertain")
  expect(authorized.normalization.id).toBe(fixture.normalization.id)
  expect(current.wholeBook?.allowance).toMatchObject({ used: 1, uncertainCounts: true })
  const snapshot = processingSnapshot({ fixture, initial, current, requests: adapter.requests })
  expect(snapshot.dispatches).toMatchObject([
    {
      partId: part?.id,
      partStatus: "uncertain",
      nativeObserved: true,
      attempt: { id: attempt.id, state: "outcome_unknown" },
    },
  ])
  expect(snapshot.ledger.dispatched).toEqual(snapshot.ledger.planned)
  expect(snapshot.ledger.transmitted).toEqual([])
  expect(snapshot.ledger.uncertain).toEqual(snapshot.ledger.planned)
  expect(snapshot.ledger.unsent).toEqual([])
  expect(snapshot.ledger.processed).toEqual([])
  expect(snapshot.receipts).toEqual([])
  await writeFile(join(evidence, "snapshot.json"), JSON.stringify(snapshot, null, 2), {
    mode: 0o600,
    flag: "wx",
  })
  expect(() => processingSnapshot({ fixture, initial, current, requests: [] })).toThrow(
    "Persisted map dispatch lacks observed request identity",
  )
  expect((await worker.runNext()).kind).toBe("idle")
  expect(bookFixtureTurns(fixture)).toEqual(native)
})
