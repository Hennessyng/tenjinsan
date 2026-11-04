import {
  contentDigest,
  FullBookGroupId,
  FullBookTestError,
  FullBookTestInput,
  FullBookTestSession,
  fullBookManagedThread,
  planFullBookTest,
  subscriptionDestination,
  WindowOriginal,
} from "@reading-studio/contracts"
import { packFullBookTest } from "@reading-studio/generation/full-book-test"
import { type Storage, serializeRpcFrame } from "@reading-studio/storage"
import { z } from "zod"

export const FullBookPreparationOptions = z
  .strictObject({
    mode: z.literal("full-book-test-1"),
    policy: FullBookTestInput.unwrap().shape.policy,
    sourceCeiling: z.number().int().positive().max(10000),
    collectorBytes: z.number().int().positive().max(128000),
    timeoutMs: z.number().int().positive().max(90000),
  })
  .readonly()
export type FullBookPreparationOptions = z.infer<typeof FullBookPreparationOptions>
export class FullBookPreparationError extends Error {
  constructor(readonly reason: "source-or-route-stale" | "budget" | "review-stale") {
    super(`Experimental preparation refused: ${reason}`)
    this.name = "FullBookPreparationError"
  }
}
export function prepareFullBook(
  storage: Storage,
  scope: Readonly<{ owner: string; setupId: string }>,
  options: FullBookPreparationOptions,
) {
  const setup = storage.sources.getSetup(scope.setupId)
  if (!setup) throw new FullBookPreparationError("source-or-route-stale")
  const normalization = storage.sources.getNormalization(setup.analysis.normalizationRevisionId),
    destination = setup.analysis.destination
  const study = storage.sources
    .listStudiesByEdition(setup.editionId)
    .find((study) => study.id === setup.studyId && study.ownerId === scope.owner)
  if (
    !study ||
    !normalization ||
    !storage.fullBookConsent.isCurrentSource(normalization.editionId, normalization.id) ||
    storage.sources.getLatestSetup(study.id)?.id !== setup.id ||
    setup.analysis.provider !== "chatgpt-subscription" ||
    !destination ||
    storage.sources.getInstallation(scope.owner) !== destination.installationId ||
    storage.subscriptionConnections.revision(destination.installationId, "chatgpt-subscription") !==
      destination.connectionRevision
  )
    throw new FullBookPreparationError("source-or-route-stale")
  const settings = setup.analysis.settings
  const cached = storage.subscriptionLogin.storedStatus(destination.installationId)
  const cachedDestination = subscriptionDestination(
    "chatgpt-subscription",
    destination.installationId,
    cached,
  )
  if (
    cached.status !== "connected" ||
    !cached.generation ||
    cached.catalog !== "checked" ||
    JSON.stringify(cachedDestination) !== JSON.stringify(destination) ||
    !cached.models.some((model) => model.model === setup.analysis.model)
  )
    throw new FullBookPreparationError("source-or-route-stale")
  if (
    settings.temperature !== 0 ||
    settings.topP !== 1 ||
    settings.seed !== null ||
    settings.reasoningEffort !== "default"
  )
    throw new FullBookPreparationError("source-or-route-stale")
  const readable = normalization.resources.flatMap((resource) =>
    resource.status === "included"
      ? resource.blocks
          .filter((block) => block.text.length > 0)
          .map((block) => ({ resource, block }))
      : [],
  )
  const groups = normalization.resources.flatMap((resource) => {
    const blockIds = resource.status === "included" ? resource.blocks.map((block) => block.id) : []
    return blockIds.length
      ? [
          {
            id: FullBookGroupId.parse(
              contentDigest(JSON.stringify([normalization.id, resource.path])),
            ),
            blockIds,
          },
        ]
      : []
  })
  const originals = readable.map(({ resource, block }) =>
    WindowOriginal.parse({
      editionId: normalization.editionId,
      normalizationRevisionId: normalization.id,
      resourcePath: resource.path,
      blockId: block.id,
      start: 0,
      end: block.text.length,
      originalFragment: block.text,
      ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
    }),
  )
  if (!originals.length) throw new FullBookTestError("source")
  const input = FullBookTestInput.parse({
    version: "full-book-test-1",
    hierarchyPolicy: "direct-children-2",
    purpose: "experimental-analysis-only",
    routeEvidence: "experimental-app-guards-not-live-certificate",
    normalization,
    groups,
    windows: [originals],
    policy: options.policy,
  })
  const initial = FullBookTestSession.parse({
    enabled: true,
    purpose: "full-book-test-1",
    input,
    plan: planFullBookTest(input),
    destination,
    model: setup.analysis.model,
    settings,
  })
  const setupFrame = serializeRpcFrame({
    provider: "chatgpt-subscription",
    id: 2147483646,
    method: "thread/start",
    params: fullBookManagedThread(initial.model, `/private/tmp/tenjinsan-study-${"x".repeat(128)}`),
    binding: "f".repeat(64),
  })
  const session = packFullBookTest(initial, {
    threadId: "t".repeat(256),
    rpcId: 2147483647,
    setupBytes: setupFrame.bytes,
  })
  const prior = storage.fullBookConsent.preview(scope.owner, normalization.editionHash)
  const budget = {
    ...prior,
    proposedMaxJobs: session.plan.nodes.length,
    proposedMaxAttempts: session.plan.maxAttempts,
    sourceCeiling: options.sourceCeiling,
    fits: prior.spent + prior.held + session.plan.maxAttempts <= options.sourceCeiling,
  }
  const summary = {
    mode: options.mode,
    kind: "ready" as const,
    setupId: setup.id,
    source: {
      normalizationRevisionId: normalization.id,
      sourceHash: normalization.editionHash,
      coverage: normalization.coverage,
      omissions: normalization.omissions ?? [],
      readableBlocks: readable.length,
      availableTextUtf8Bytes: originals.reduce(
        (sum, span) => sum + Buffer.byteLength(span.originalFragment, "utf8"),
        0,
      ),
      originalFileIncluded: false as const,
      coverageClaim: "available-readable-text-not-full-original" as const,
    },
    route: {
      provider: "chatgpt-subscription" as const,
      model: session.model,
      binding: contentDigest(JSON.stringify(destination)),
      observation: "stored-only-not-live-readiness" as const,
    },
    hierarchy: {
      policyVersion: session.input.hierarchyPolicy ?? "copied-exceptions-1",
      windows: session.input.windows.length,
      groups: groups.length,
      reductions: session.plan.nodes.filter((node) => node.kind === "reduce").length,
      levels: Math.max(
        ...session.plan.nodes.filter((node) => node.kind === "reduce").map((node) => node.level),
      ),
      maxFindings: options.policy.maxFindings,
      findingBatches: session.plan.findingBatches,
      policy: options.policy,
      overflow: "refuse-no-truncation-no-new-nodes-or-automatic-retry" as const,
    },
    runtime: { collectorBytes: options.collectorBytes, timeoutMs: options.timeoutMs },
    budget,
    native: { enabled: false as const, reason: "release-and-runtime-binding-required" as const },
    warnings: {
      en: [
        "Experimental estimates and app byte/time limits are not provider token or cost guarantees.",
        "Collector bytes do not enforce output tokens. Interrupt/kill may leave provider usage unknown; cancellation is not instant.",
        "All readable content and derived data would be sent only after a new exact consent; omissions remain excluded.",
      ],
      ja: [
        "実験用の見積もりとアプリのバイト数・時間制限は、提供元のトークン数や費用の上限を保証しません。",
        "収集バイト数は出力トークン数を制限しません。中断・強制終了後も提供元の使用量が不明な場合があり、即時停止は保証されません。",
        "新しい一致した同意の後にのみ、読める内容と派生データを送信します。除外された内容は含みません。",
      ],
    },
  }
  return {
    session,
    setup,
    summary,
    reviewBinding: contentDigest(
      JSON.stringify({ setup, session, options, prior, summary, cached }),
    ),
  }
}
