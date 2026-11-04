import {
  contentDigest,
  FullBookOutputError,
  type FullBookTestReceipt,
  measureFullBookTestPayload,
} from "@reading-studio/contracts"
import {
  acceptFullBookTestOutput,
  fullBookTestRequest,
  restoreFullBookTest,
} from "@reading-studio/generation/full-book-test"
import { localToolInput } from "@reading-studio/providers"
import type { PreparedRpcFrame, RpcFrameWriter } from "@reading-studio/storage"

export type FullBookTestJob = Readonly<{
  targetHash: string
  frame: PreparedRpcFrame
  requestHash: string
}>

export class FullBookTestRuntime {
  private readonly session: ReturnType<typeof restoreFullBookTest>["session"]
  private receipts: readonly FullBookTestReceipt[]
  private readonly owned = new WeakSet<FullBookTestJob>()
  private readonly ready = new WeakSet<FullBookTestJob>()

  constructor(session: unknown, receipts: unknown = []) {
    const restored = restoreFullBookTest(session, receipts)
    this.session = restored.session
    this.receipts = restored.receipts
  }

  prequeue(writer: RpcFrameWriter, threadId: string): FullBookTestJob {
    const { target, request } = fullBookTestRequest(this.session, this.receipts)
    const frame = writer.prepare(
      "turn/start",
      { threadId, ...localToolInput("chatgpt-subscription", request) },
      target.hash,
    )
    const observed = measureFullBookTestPayload(this.session.input, {
      kind: "application-request",
      serialized: frame.serialized,
    })
    writer.assertWritable(frame, {
      expectedBinding: target.hash,
      maxBytes: this.session.input.policy.maxAppBytes,
    })
    const job = Object.freeze({ targetHash: target.hash, frame, requestHash: observed.hash })
    this.owned.add(job)
    return job
  }

  beforeDispatch(job: FullBookTestJob, writer: RpcFrameWriter) {
    const { target } = fullBookTestRequest(this.session, this.receipts)
    if (
      !this.owned.has(job) ||
      job.targetHash !== target.hash ||
      contentDigest(job.frame.serialized) !== job.requestHash
    )
      throw new FullBookOutputError("lineage")
    writer.assertWritable(job.frame, {
      expectedBinding: target.hash,
      maxBytes: this.session.input.policy.maxAppBytes,
    })
    const observation = measureFullBookTestPayload(this.session.input, {
      kind: "application-request",
      serialized: job.frame.serialized,
    })
    this.ready.add(job)
    return observation
  }

  accept(job: FullBookTestJob, serialized: string) {
    const { target } = fullBookTestRequest(this.session, this.receipts)
    if (!this.ready.has(job) || job.targetHash !== target.hash)
      throw new FullBookOutputError("lineage")
    this.ready.delete(job)
    const next = acceptFullBookTestOutput(this.session, this.receipts, serialized)
    this.receipts = next
    return next
  }

  snapshot() {
    return this.receipts
  }
}
