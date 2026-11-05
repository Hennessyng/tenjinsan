import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { NormalizationRevision, TransmissionGrant } from "@reading-studio/contracts"
import { ProviderReceipt } from "@reading-studio/providers"
import { ExecutionTransitionError } from "@reading-studio/storage"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
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
const changes = [
  "account",
  "connection",
  "model",
  "grant",
  "derived-consent",
  "source",
  "superseded-setup",
] as const
const boundaries = ["after-reply", "on-validated"] as const
const cases = changes.flatMap((change) => boundaries.map((boundary) => ({ change, boundary })))

it.each(cases)(
  "preserves receipt but rejects $change at $boundary before stale acceptance",
  async ({ change, boundary }) => {
    // Given
    const flow = await managedProviderFixture()
    fixtures.push(flow)
    prepareManagedRoute()
    const job = flow.claim()
    const sources = flow.storage.sources
    const setup = sources.getSetup(job.setupRevisionId)
    const grant = sources.getGrant(job.grant.id)
    if (!setup || !grant) throw new TypeError("Missing synthetic authority")
    const mutate = () => {
      switch (change) {
        case "account":
        case "model": {
          const login = flow.storage.subscriptionLogin
          const metadata = login.status(flow.authority.installationId)
          if (!metadata.account) throw new TypeError("Missing synthetic account")
          vi.spyOn(login, "status").mockReturnValue(
            change === "model"
              ? { ...metadata, models: [] }
              : {
                  ...metadata,
                  account: { ...metadata.account, accountId: "changed-synthetic-account" },
                },
          )
          return
        }
        case "connection":
          flow.storage.subscriptionConnections.disconnect(
            flow.authority.installationId,
            "chatgpt-subscription",
          )
          return
        case "grant":
        case "derived-consent": {
          const current = TransmissionGrant.parse(
            change === "grant"
              ? { ...grant, kind: "revoked", revokedAt: new Date().toISOString() }
              : { ...grant, categories: ["book-text"] },
          )
          vi.spyOn(sources, "getGrant").mockReturnValue(current)
          return
        }
        case "source":
        case "superseded-setup": {
          let analysis = setup.analysis
          const { batchedVerificationReserve: _reserve, ...unbound } = setup
          if (change === "source") {
            const original = sources.getNormalization(analysis.normalizationRevisionId)
            if (!original) throw new TypeError("Missing synthetic normalization")
            const next = NormalizationRevision.parse({
              ...original,
              id: "acceptance-source-v2",
              normalizerVersion: "synthetic-v2",
              resources: original.resources.map((r) =>
                r.status === "included"
                  ? {
                      ...r,
                      blocks: r.blocks.map((b) => ({
                        ...b,
                        text: `${b.text} Updated synthetic source.`,
                      })),
                    }
                  : r,
              ),
            })
            sources.appendNormalization({ record: next, parentRevisionId: original.id })
            const {
              batchReserveId: _reserveId,
              plan: _plan,
              ...processing
            } = analysis.processing ?? {}
            analysis = { ...analysis, normalizationRevisionId: next.id, processing }
          }
          sources.appendSetup({
            record: {
              ...(change === "source" ? unbound : setup),
              id: "acceptance-setup-v2",
              analysis,
              generation: {
                ...setup.generation,
                promptVersion:
                  change === "superseded-setup"
                    ? "synthetic-generation-v2"
                    : setup.generation.promptVersion,
              },
            },
            parentRevisionId: setup.id,
          })
          return
        }
        default:
          throw new TypeError(`Unknown authority change ${change satisfies never}`)
      }
    }
    await flow.respond({ answer: "synthetic" })
    if (boundary === "after-reply") {
      const dispatch = flow.adapter.dispatch.bind(flow.adapter)
      vi.spyOn(flow.adapter, "dispatch").mockImplementation(async (request) => {
        const receipt = await dispatch(request)
        mutate()
        return receipt
      })
    }
    const onValidated = vi.fn(() => {
      if (boundary === "on-validated") mutate()
    })
    // When
    const [outcome] = await Promise.allSettled([
      flow.runner.execute(job, {
        ...providerStage,
        ...(change === "derived-consent"
          ? { derivedData: [{ kind: "synthetic-derived-input" }] }
          : {}),
        onValidated,
      }),
    ])
    if (!outcome) throw new TypeError("Missing runner outcome")
    const attempts = flow.storage.execution.listAttempts(job.runId)
    const attempt = attempts[0]
    const body = attempt && flow.storage.execution.getAttemptReceipt(attempt.id)
    const receipt = body ? ProviderReceipt.parse(JSON.parse(new TextDecoder().decode(body))) : null
    const persisted = flow.storage.execution.getJob(job.id)
    const requests = await flow.requests()
    const evidence = await evidenceDirectory("acceptance-boundary")
    await writeFile(
      join(evidence, `${change}-${boundary}.json`),
      JSON.stringify(
        {
          change,
          boundary,
          fixtureJobStage: job.stage,
          setupCaseMeaning:
            change === "superseded-setup"
              ? "latest setup changed; not an isolated schema-version branch"
              : null,
          outcome:
            outcome.status === "fulfilled" ? outcome.value : { rejected: String(outcome.reason) },
          attempts,
          receipt,
          persisted,
          requests,
          onValidatedCalls: onValidated.mock.calls.length,
          run: flow.storage.execution.getRun(job.runId),
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    )
    // Then
    expect(outcome.status).toBe("fulfilled")
    expect(attempts).toMatchObject([
      { state: "response-received", usage: { kind: "known", inputTokens: 8, outputTokens: 4 } },
    ])
    expect(receipt).toMatchObject({
      kind: "output",
      usage: { kind: "known", inputTokens: 8, outputTokens: 4 },
    })
    expect(persisted).toMatchObject({ usage: { kind: "known", inputTokens: 8, outputTokens: 4 } })
    if (["grant", "derived-consent", "source", "superseded-setup"].includes(change)) {
      expect(persisted).toMatchObject({
        state: "failed",
        error: { code: "unauthorized", retryable: false },
      })
      expect(() => flow.storage.execution.retryProviderJob(job.id)).toThrow(
        ExecutionTransitionError,
      )
    }
    expect.soft(persisted).not.toHaveProperty("resultHash")
    expect.soft(persisted?.state).not.toBe("completed")
    expect.soft(onValidated).toHaveBeenCalledTimes(boundary === "after-reply" ? 0 : 1)
    expect(flow.storage.execution.getRun(job.runId)?.reservedCalls).toBe(1)
    expect(requests).toHaveLength(1)
    expect(flow.network).not.toHaveBeenCalled()
    expect(flow.login).not.toHaveBeenCalled()
  },
)

it("rechecks authority after schema validation before invoking the acceptance callback", async () => {
  // Given
  const flow = await managedProviderFixture()
  fixtures.push(flow)
  prepareManagedRoute()
  const job = flow.claim()
  await flow.respond({ answer: "synthetic" })
  const onValidated = vi.fn()
  const schema = providerStage.schema.transform((value) => {
    flow.storage.subscriptionConnections.disconnect(
      flow.authority.installationId,
      "chatgpt-subscription",
    )
    return value
  })
  // When
  const result = await flow.runner.execute(job, {
    ...providerStage,
    schema,
    wireSchema: z.toJSONSchema(providerStage.schema),
    onValidated,
  })
  // Then
  expect(onValidated).not.toHaveBeenCalled()
  expect(result).not.toHaveProperty("resultHash")
  expect(result.state).not.toBe("completed")
  expect(result.usage).toEqual({ kind: "known", inputTokens: 8, outputTokens: 4 })
  expect(flow.storage.execution.listAttempts(job.runId)).toMatchObject([
    { state: "response-received" },
  ])
})
