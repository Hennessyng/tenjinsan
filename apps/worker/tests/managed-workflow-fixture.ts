import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import {
  type Job,
  LocalSubscriptionSession,
  type NormalizationRevision,
  subscriptionDestination,
} from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import { openStorage, type Storage } from "@reading-studio/storage"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { vi } from "vitest"
import { z } from "zod"
import { advanceProductionStage, recoverQuestionHandoffs } from "../src/production-handoffs.ts"
import { resolveProductionStage } from "../src/production-stage.ts"
import { WorkerRuntime } from "../src/runtime.ts"
import { attachManagedSession } from "./managed-session-fixture.ts"
import { type ManagedSetupOptions, managedSetup } from "./managed-setup-fixture.ts"
import { fixtureCapacity } from "./whole-book-fixture.ts"

const RecordedTurn = z
  .object({
    model: z.string(),
    input: z.array(z.object({ type: z.literal("text"), text: z.string() })),
    outputSchema: z.unknown().optional(),
  })
  .passthrough()
export type ManagedWorkflow = Awaited<ReturnType<typeof managedWorkflowFixture>>
export async function managedWorkflowFixture(
  input: ManagedSetupOptions & { readonly document?: NormalizationRevision } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "ten26-managed-flow-"))
  const control = join(directory, "control")
  const home = join(directory, "empty-owned-profile")
  await mkdir(control)
  await mkdir(home)
  await writeFile(join(control, "requests.jsonl"), "")
  const binary = join(directory, "fake-app-server")
  await writeFile(
    binary,
    `#!/bin/sh\nexec "${process.execPath}" "${resolve("apps/worker/tests/managed-workflow-rpc.cjs")}" "control:${control}" "$@"\n`,
    { mode: 0o700 },
  )
  vi.stubEnv("STUDIO_SUBSCRIPTION_CODEX_BINARY", binary)
  const network = vi.fn(async () => {
    throw new TypeError("External network forbidden")
  })
  vi.stubGlobal("fetch", network)
  const options = {
    databasePath: join(directory, "studio.sqlite"),
    privateDataRoot: join(directory, "private"),
  }
  let storage = openStorage(options)
  const graph = completeGraphFixtures("openrouter")
  const ownerId = storage.libraryOwnerId()
  const installationId = storage.sources.createInstallation({ id: "managed-installation", ownerId })
  const normalization = input.document ?? {
    ...graph.normalization,
    resources: graph.normalization.resources.map((resource) =>
      resource.status === "included"
        ? {
            ...resource,
            blocks: resource.blocks.map(({ pageLabel: _pageLabel, ...block }) => block),
          }
        : resource,
    ),
  }
  storage.sources.persistDocument({ edition: graph.edition, normalization })
  storage.sources.createStudy({ id: graph.setup.studyId, ownerId, editionId: graph.edition.id })
  const metadata = LocalSubscriptionSession.parse({
    status: "connected",
    generation: "00000000-0000-4000-8000-000000000001",
    connectionRevision: 0,
    billingRoute: "subscription-provider-managed",
    authUrl: null,
    expiresAt: null,
    catalog: "checked",
    account: { email: null, accountId: "synthetic", planType: "fixture", workspaceId: null },
    models: [{ model: "study-model", label: "Synthetic managed model" }],
  })
  const capacity = {
    ...fixtureCapacity,
    provider: "chatgpt-subscription" as const,
    model: "study-model",
    id: "synthetic-managed-workflow-v1",
    evidence: "Test-only byte-token grammar; not real ChatGPT capacity evidence",
  }
  function attach(target: Storage) {
    return attachManagedSession(target, { home, metadata })
  }
  let session = attach(storage)
  const destination = subscriptionDestination("chatgpt-subscription", installationId, metadata)
  if (!destination) throw new TypeError("Missing synthetic connection identity")
  const certifiedFixture = { ...capacity, destination }
  const { app, setupId, sent } = await managedSetup({
    storage,
    session,
    metadata,
    installationId,
    databasePath: options.databasePath,
    privateRoot: options.privateDataRoot,
    normalizationId: normalization.id,
    capacity: certifiedFixture,
    options: input,
  })
  const grantId = `grant-${setupId}`
  function authority() {
    return {
      storage,
      ownerId,
      installationId,
      localSubscriptions: true,
      capacity: certifiedFixture,
      clock: () => new Date(),
    }
  }
  function worker() {
    return new WorkerRuntime({
      storage,
      clock: () => new Date(),
      leaseDurationMs: 120000,
      tokenFactory: randomUUID,
      attemptIdFactory: () => randomUUID(),
      resolveStage: (job) => resolveProductionStage(authority(), job),
    })
  }
  async function invoke(...responses: readonly unknown[]) {
    await respond(...responses)
    const result = await worker().runNext()
    if (result.kind === "provider") advanceProductionStage(storage, result.job, authority())
    return result
  }
  async function respond(...responses: readonly unknown[]) {
    await writeFile(join(control, "responses.json"), JSON.stringify(responses))
    await writeFile(join(control, "cursor"), "0")
  }
  return {
    get storage() {
      return storage
    },
    setupId,
    grantId,
    options,
    control,
    network,
    attach,
    app,
    sent,
    normalizationId: normalization.id,
    get session() {
      return session
    },
    studyId: graph.setup.studyId,
    metadata,
    capacity: certifiedFixture,
    authority,
    respond,
    invoke,
    get login() {
      return session.connect
    },
    analysis: () => new BookMapPipeline(authority()).prepare(setupId, grantId),
    requests: async () =>
      z.array(RecordedTurn).parse(
        (await readFile(join(control, "requests.jsonl"), "utf8"))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      ),
    async reopen() {
      await session.close()
      storage.close()
      storage = openStorage(options)
      session = attach(storage)
      recoverQuestionHandoffs(storage, true, certifiedFixture)
    },
    close: async () => {
      await session.close()
      storage.close()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

export function completedInvocation(
  result: Awaited<ReturnType<ManagedWorkflow["invoke"]>>,
): Extract<Job, { readonly state: "completed" }> {
  if (result.kind !== "provider" || result.job.state !== "completed")
    throw new TypeError(`Expected completed managed invocation: ${JSON.stringify(result)}`)
  return result.job
}
