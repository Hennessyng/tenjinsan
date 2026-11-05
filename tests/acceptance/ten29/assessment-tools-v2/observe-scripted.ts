import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SubscriptionToolRpc } from "@reading-studio/storage/test-support"
import { vi } from "vitest"
import { z } from "zod"
import type { CandidateBody } from "../assessment-v2/control-types.ts"
import { exerciseAssessmentCase } from "../assessment-v2/exercise-case.ts"
import { canonicalText } from "../assessment-v2/source-projection.ts"
import { digest } from "./integrity.ts"
import { projectCandidate } from "./projection.ts"

const Frame = z.object({ method: z.string(), params: z.unknown() })
const Turn = z.object({
  model: z.string(),
  input: z.array(z.object({ type: z.literal("text"), text: z.string() })).length(1),
  threadId: z.string(),
})
const Thread = z.object({
  model: z.string(),
  modelProvider: z.literal("openai"),
  allowProviderModelFallback: z.literal(false),
  ephemeral: z.literal(true),
  cwd: z.string(),
  runtimeWorkspaceRoots: z.array(z.string()).length(1),
  environments: z.array(z.unknown()).length(0),
  dynamicTools: z.array(z.unknown()).length(0),
  selectedCapabilityRoots: z.array(z.unknown()).length(0),
  approvalPolicy: z.literal("never"),
  sandbox: z.literal("read-only"),
  config: z.object({
    project_doc_max_bytes: z.literal(0),
    web_search: z.literal("disabled"),
    "features.shell_tool": z.literal(false),
    "features.code_mode": z.literal(false),
    "features.multi_agent": z.literal(false),
    "features.hooks": z.literal(false),
    "features.plugins": z.literal(false),
    "features.apps": z.literal(false),
  }),
})
type Observation = {
  readonly method: string
  readonly params: unknown
  readonly result: unknown
  readonly provider: string
  readonly cwd: string
}
export async function observeScriptedCandidate(candidate: CandidateBody) {
  const original = SubscriptionToolRpc.prototype.requestPrepared,
    observations: Observation[] = []
  vi.spyOn(SubscriptionToolRpc.prototype, "requestPrepared").mockImplementation(async function (
    this: SubscriptionToolRpc,
    ...args: Parameters<SubscriptionToolRpc["requestPrepared"]>
  ) {
    const frame = Frame.parse(JSON.parse(args[0].serialized)),
      result = await original.call(this, ...args)
    observations.push({ ...frame, result, provider: args[0].provider, cwd: this.cwd })
    return result
  })
  const artifact = await exerciseAssessmentCase(candidate, "epub")
  const expected = artifact.setup.analysis,
    allowed = new Set(["initialize", "mcpServerStatus/list", "thread/start", "turn/start"])
  if (observations.some((row) => !allowed.has(row.method) || row.provider !== expected.provider))
    throw new TypeError("Unexpected native request/provider")
  const threads = observations.filter((row) => row.method === "thread/start"),
    turns = observations.filter((row) => row.method === "turn/start"),
    mcp = observations.filter((row) => row.method === "mcpServerStatus/list")
  if (
    threads.length !== artifact.receipts.length ||
    turns.length !== artifact.receipts.length ||
    mcp.length !== artifact.receipts.length
  )
    throw new TypeError("Missing observed thread/turn/control")
  for (const row of mcp)
    z.object({ data: z.array(z.unknown()).length(0), nextCursor: z.null() }).parse(row.result)
  for (const row of threads) {
    const request = Thread.parse(row.params),
      response = z
        .object({
          model: z.string(),
          modelProvider: z.literal("openai"),
          cwd: z.string(),
          instructionSources: z.array(z.unknown()).length(0),
          sandbox: z.object({ type: z.literal("readOnly") }),
          thread: z.object({ id: z.string() }),
        })
        .parse(row.result)
    if (
      request.model !== expected.model ||
      response.model !== expected.model ||
      request.cwd !== row.cwd ||
      response.cwd !== row.cwd ||
      request.runtimeWorkspaceRoots[0] !== row.cwd
    )
      throw new TypeError("Observed native model/workspace change")
  }
  const wirePayloads = turns.map((row) => {
    const turn = Turn.parse(row.params)
    if (turn.model !== expected.model) throw new TypeError("Observed turn model changed")
    return z
      .array(z.unknown())
      .parse(
        JSON.parse(
          turn.input[0]?.text.slice((turn.input[0]?.text.lastIndexOf("\n") ?? -1) + 1) ?? "",
        ),
      )
  })
  const mapped = wirePayloads
    .filter((payload) => z.object({ kind: z.string() }).parse(payload[0]).kind === "chapter-map")
    .flatMap((payload) => z.array(z.object({ text: z.string() })).parse(payload.slice(1)))
  if (
    canonicalText(mapped.map((row) => row.text).join(" ")) !== artifact.projection.canonicalText ||
    artifact.counts.attempts !== turns.length ||
    artifact.counts.questions !== 0 ||
    artifact.counts.publications !== 0
  )
    throw new TypeError("Monitored original processing/order mismatch")
  for (const job of artifact.jobs)
    if (
      job.provider !== expected.provider ||
      job.model !== expected.model ||
      job.setupRevisionId !== artifact.setup.id ||
      job.grant.id !== artifact.grant?.id ||
      digest(job.grant.destination) !== digest(expected.destination) ||
      job.cancellationRequested ||
      job.state !== "completed"
    )
      throw new TypeError("Monitored job/source/grant/destination binding changed")
  const fixtureSource = resolve("apps/worker/tests/managed-workflow-rpc.cjs")
  const basis = {
    kind: "supplemental observed offline-scripted run",
    runId: artifact.runId,
    candidateContentDigest: projectCandidate(artifact).contentDigest,
    projectionDigest: artifact.projection.canonicalSha256,
    jobs: artifact.jobs.map((job) => ({
      id: job.id,
      model: job.model,
      provider: job.provider,
      setupId: job.setupRevisionId,
      grantId: job.grant.id,
    })),
    receipts: artifact.receipts.map((row) => row.receiptSha256),
    allowedRequests: [...allowed],
    actualMethods: observations.map((row) => row.method),
    nativeThreadRequestsAndResponses: threads,
    mcpStatuses: mcp.map((row) => row.result),
    fakeExecutableSourceSha256: createHash("sha256")
      .update(readFileSync(fixtureSource))
      .digest("hex"),
    environment:
      "owned registered fake RPC executable; fetch forbidden by fixture; no live account or actual model",
    sourceProcessing:
      "all included normalized source units observed in actual map input and accepted into completed source-bound structured-map jobs",
    citationLocations: "all stored citation raw excerpts resolve exactly; NOT semantic support",
    authority:
      "observed synthetic provider/model/grant/destination bindings, empty MCP, read-only no-tools/fallback controls; not an external account identity or arbitrary-host audit",
  }
  return {
    basis,
    technical: {
      evidenceDigest: digest(basis),
      incompleteIncludedProcessing: false,
      unauthorizedAuthorityChange: false,
      citationLocationsResolved: true,
      scope: basis.environment + "; " + basis.authority,
      semanticCitationSupport: "NOT ASSESSED; human source-faithfulness judgment required",
    },
  }
}
