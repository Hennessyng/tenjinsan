import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { contentDigest, NormalizationRevision } from "@reading-studio/contracts"
import { authorizeSource, ProviderError, ProviderReceipt } from "@reading-studio/providers"
import { afterEach, expect, it, vi } from "vitest"
import {
  managedProviderFixture,
  providerStage,
} from "../../apps/worker/tests/managed-provider-fixture.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { prepareManagedRoute } from "./ten29/portable-fixtures.ts"

const fixtures: Awaited<ReturnType<typeof managedProviderFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const evidence = await evidenceDirectory("safety-authority")

it.each([
  { change: "account", boundary: "before-dispatch" },
  { change: "connection-revocation", boundary: "before-dispatch" },
  { change: "account", boundary: "after-native-reply" },
  { change: "connection-revocation", boundary: "after-native-reply" },
] as const)(
  "rejects $change at $boundary without accepting stale output",
  async ({ change, boundary }) => {
    // Given
    const flow = await managedProviderFixture()
    fixtures.push(flow)
    prepareManagedRoute()
    const job = flow.claim()
    const checkpointBefore = job.checkpoint
    const onValidated = vi.fn(() => {
      flow.storage.execution.saveCheckpoint({
        jobId: job.id,
        token: job.lease.token,
        fence: job.lease.fence,
        now: flow.authority.clock().toISOString(),
        checkpoint: contentDigest("synthetic-validation-side-effect"),
      })
    })
    const changeAuthority = async () => {
      const login = flow.storage.subscriptionLogin
      if (change === "connection-revocation") {
        await login.disconnect(flow.authority.installationId)
        return
      }
      const before = login.status(flow.authority.installationId)
      if (!before.account) throw new TypeError("Missing synthetic account")
      const changed = {
        ...before,
        account: { ...before.account, accountId: "different-synthetic-account" },
      }
      vi.spyOn(login, "status").mockReturnValue(changed)
      vi.spyOn(login, "refresh").mockResolvedValue(changed)
    }
    await flow.respond({ answer: "synthetic" })
    if (boundary === "before-dispatch") await changeAuthority()
    else {
      const dispatch = flow.adapter.dispatch.bind(flow.adapter)
      vi.spyOn(flow.adapter, "dispatch").mockImplementation(async (request) => {
        const receipt = await dispatch(request)
        await changeAuthority()
        return receipt
      })
    }
    // When
    const result = await flow.runner.execute(job, { ...providerStage, onValidated })
    const attempts = flow.storage.execution.listAttempts(job.runId)
    const requests = await flow.requests()
    const persisted = flow.storage.execution.getJob(job.id)
    let currentAuthorization = "authorized"
    try {
      authorizeSource(flow.authority, result)
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error
      currentAuthorization = error.code
    }
    await writeFile(
      join(evidence, `${change}-${boundary}.json`),
      JSON.stringify(
        {
          boundary,
          change,
          currentAuthorization,
          onValidatedCalls: onValidated.mock.calls.length,
          checkpointBefore,
          currentConnectionRevision: flow.storage.subscriptionConnections.revision(
            flow.authority.installationId,
            "chatgpt-subscription",
          ),
          currentSyntheticStatus: flow.storage.subscriptionLogin.status(
            flow.authority.installationId,
          ),
          result,
          attempts,
          requests,
          persisted,
          run: flow.storage.execution.getRun(job.runId),
          receipts: attempts.map((a) => {
            const bytes = flow.storage.execution.getAttemptReceipt(a.id)
            return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null
          }),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    )
    // Then
    expect(requests).toHaveLength(boundary === "before-dispatch" ? 0 : 1)
    expect(attempts).toHaveLength(boundary === "before-dispatch" ? 0 : 1)
    expect(flow.network).not.toHaveBeenCalled()
    expect(flow.login).not.toHaveBeenCalled()
    expect(currentAuthorization).toBe("subscription-connection-changed")
    if (boundary === "after-native-reply") {
      const known = { kind: "known", inputTokens: 8, outputTokens: 4 }
      expect(attempts).toMatchObject([{ state: "response-received", usage: known }])
      const attempt = attempts[0]
      if (!attempt) throw new TypeError("Lost received authority-race attempt")
      const bytes = flow.storage.execution.getAttemptReceipt(attempt.id)
      expect(bytes).not.toBeNull()
      if (!bytes) throw new TypeError("Lost received authority-race receipt")
      expect(ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(bytes)))).toMatchObject({
        kind: "output",
        usage: known,
      })
      expect(result.usage).toEqual(known)
      expect(persisted).toMatchObject({ usage: known })
    }
    expect.soft(persisted).not.toHaveProperty("resultHash")
    expect.soft(result).not.toHaveProperty("resultHash")
    expect.soft(persisted?.state).not.toBe("completed")
    expect.soft(result.state).not.toBe("completed")
    expect.soft(onValidated).not.toHaveBeenCalled()
    expect.soft(persisted?.checkpoint).toBe(checkpointBefore)
  },
)

it("does not dispatch queued work after a new source normalization/setup becomes current", async () => {
  // Given
  const flow = await managedProviderFixture()
  fixtures.push(flow)
  prepareManagedRoute()
  const job = flow.claim()
  const setup = flow.storage.sources.getSetup(job.setupRevisionId)
  const original =
    setup && flow.storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  if (!setup || !original) throw new TypeError("Missing persisted source")
  const changed = NormalizationRevision.parse({
    ...original,
    id: "changed-source",
    normalizerVersion: "synthetic-revision-2",
    resources: original.resources.map((r) =>
      r.status === "included"
        ? {
            ...r,
            blocks: r.blocks.map((b) => ({ ...b, text: `${b.text} New synthetic revision.` })),
          }
        : r,
    ),
  })
  flow.storage.sources.appendNormalization({ record: changed, parentRevisionId: original.id })
  const { batchedVerificationReserve: _reserve, ...unbound } = setup
  const { batchReserveId: _reserveId, plan: _plan, ...processing } = setup.analysis.processing ?? {}
  flow.storage.sources.appendSetup({
    record: {
      ...unbound,
      id: "new-source-setup",
      analysis: {
        ...setup.analysis,
        normalizationRevisionId: changed.id,
        processing,
      },
    },
    parentRevisionId: setup.id,
  })
  // When
  const result = await flow.runner.execute(job, providerStage)
  const attempts = flow.storage.execution.listAttempts(job.runId)
  const requests = await flow.requests()
  await writeFile(
    join(evidence, "changed-source.json"),
    JSON.stringify(
      {
        result,
        original,
        changed,
        attempts,
        requests,
        persisted: flow.storage.execution.getJob(job.id),
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  )
  // Then
  expect(result).toMatchObject({ state: "failed", error: { code: "unauthorized" } })
  expect(attempts).toEqual([])
  expect(requests).toEqual([])
  expect(flow.storage.sources.getNormalization(original.id)).toEqual(original)
  expect(flow.network).not.toHaveBeenCalled()
})
