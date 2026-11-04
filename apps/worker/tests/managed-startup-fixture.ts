import { LocalSubscriptionAdapter, type VerifiedRouteCapacity } from "@reading-studio/providers"
import * as storageModule from "@reading-studio/storage"
import { vi } from "vitest"
import { z } from "zod"
import { runWorkerProcess } from "../src/index.ts"
import { runProductionWorker } from "../src/production-runtime.ts"
import { managedQuestionOutput } from "./managed-question-fixture.ts"
import type { attachManagedSession } from "./managed-session-fixture.ts"
import type { ManagedWorkflow } from "./managed-workflow-fixture.ts"
import { WholeBookAdapter } from "./whole-book-fixture.ts"

type Session = ReturnType<typeof attachManagedSession>

export function useManagedBookReplies(flow: ManagedWorkflow) {
  const dispatch = LocalSubscriptionAdapter.prototype.dispatch
  const authored = new WholeBookAdapter()
  return vi
    .spyOn(LocalSubscriptionAdapter.prototype, "dispatch")
    .mockImplementation(async function (this: LocalSubscriptionAdapter, request) {
      const question = flow.storage.execution
        .listOwnerJobs(flow.authority().ownerId)
        .find((job) => job.stage === "questions" && job.state === "running")
      if (question) {
        const wire = managedQuestionOutput(flow, question).wire
        await flow.respond(wire)
      } else {
        const output = await authored.dispatch(request)
        if (output.kind !== "output") throw new TypeError("Missing authored synthetic output")
        await flow.respond(JSON.parse(output.text))
      }
      return dispatch.call(this, request)
    })
}

export async function runManagedProduction(
  flow: ManagedWorkflow,
  input: {
    readonly capacity?: VerifiedRouteCapacity
    readonly processEntry?: boolean
    readonly signal?: AbortSignal
    readonly configure?: (storage: storageModule.Storage, session: Session) => void
  },
) {
  for (const [key, value] of Object.entries({
    DATABASE_PATH: flow.options.databasePath,
    PRIVATE_DATA_ROOT: flow.options.privateDataRoot,
    SERVER_HOST: "127.0.0.1",
    TRUST_PROXY: "0",
    TRUSTED_ORIGINS: "http://127.0.0.1:8787",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENROUTER_API_KEY: "",
  }))
    vi.stubEnv(key, value)
  for (const key of [
    "STUDIO_LIVE_STUDY_TARGET",
    "STUDIO_PROVIDER_BASE_URL",
    "STUDIO_SYNTHETIC_TEST_MODE",
  ])
    vi.stubEnv(key, undefined)
  const stop = new AbortController()
  let observed: Session | undefined
  const open = storageModule.openStorage
  const opened = vi.spyOn(storageModule, "openStorage").mockImplementation((options) => {
    const owned = z
      .object({
        databasePath: z.literal(flow.options.databasePath),
        privateDataRoot: z.literal(flow.options.privateDataRoot),
      })
      .passthrough()
      .parse(options)
    const storage = open(owned)
    observed = flow.attach(storage)
    const fail = storage.execution.failProviderJob.bind(storage.execution)
    vi.spyOn(storage.execution, "failProviderJob").mockImplementation((value) => {
      const result = fail(value)
      stop.abort()
      return result
    })
    const unknown = storage.execution.pauseUnknownProviderJob.bind(storage.execution)
    vi.spyOn(storage.execution, "pauseUnknownProviderJob").mockImplementation((value) => {
      const result = unknown(value)
      stop.abort()
      return result
    })
    const cancel = storage.execution.cancelClaimedJob.bind(storage.execution)
    vi.spyOn(storage.execution, "cancelClaimedJob").mockImplementation((value) => {
      const result = cancel(value)
      stop.abort()
      return result
    })
    const create = storage.interviews.create.bind(storage.interviews)
    vi.spyOn(storage.interviews, "create").mockImplementation((value) => {
      const result = create(value)
      stop.abort()
      return result
    })
    input.configure?.(storage, observed)
    return storage
  })
  const signal = AbortSignal.any([
    stop.signal,
    ...(input.signal ? [input.signal] : []),
    AbortSignal.timeout(5000),
  ])
  try {
    if (input.processEntry)
      await runWorkerProcess({ signal, ...(input.capacity ? { capacity: input.capacity } : {}) })
    else await runProductionWorker(signal, input.capacity)
    if (!stop.signal.aborted && !input.signal?.aborted)
      throw new TypeError("Synthetic production outcome not reached")
    if (!observed) throw new TypeError("Production storage was not opened")
    return observed
  } finally {
    stop.abort()
    opened.mockRestore()
  }
}
