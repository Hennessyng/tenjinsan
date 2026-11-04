import {
  contentDigest,
  type FullBookTestConsent,
  type FullBookTestReceipt,
  fullBookTestRequest,
  localToolInput,
  measureFullBookTestPayload,
  structuredPrompt,
} from "@reading-studio/contracts"
import { FullBookExecutionError, type FullBookWire } from "./full-book-execution-contract.ts"
import { serializeRpcFrame } from "./rpc-frame.ts"

export function expectedFullBookWire(
  consent: FullBookTestConsent,
  receipts: readonly FullBookTestReceipt[],
  options: Readonly<{ threadId: string; rpcId: number; repair: boolean }>,
) {
  const built = fullBookTestRequest(consent.session, receipts)
  const request = options.repair
    ? {
        ...built.request,
        prompt: structuredPrompt({
          instruction: built.request.prompt,
          blocks: [],
          schemaRepair: { format: "json-only", issues: [{ code: "invalid-json", path: [] }] },
        }),
      }
    : built.request
  const frame = serializeRpcFrame({
    provider: "chatgpt-subscription",
    id: options.rpcId,
    method: "turn/start",
    params: { threadId: options.threadId, ...localToolInput("chatgpt-subscription", request) },
    binding: built.target.hash,
  })
  measureFullBookTestPayload(consent.session.input, {
    kind: "application-request",
    serialized: frame.serialized,
  })
  return {
    targetHash: built.target.hash,
    requestJson: JSON.stringify(request),
    requestHash: contentDigest(JSON.stringify(request)),
    serialized: frame.serialized,
    hash: frame.sha256,
    bytes: frame.bytes,
  }
}
export function checkFullBookWire(
  consent: FullBookTestConsent,
  receipts: readonly FullBookTestReceipt[],
  wire: FullBookWire,
) {
  const expected = expectedFullBookWire(consent, receipts, wire)
  for (const key of [
    "targetHash",
    "requestJson",
    "requestHash",
    "serialized",
    "hash",
    "bytes",
  ] as const)
    if (wire[key] !== expected[key]) throw new FullBookExecutionError("binding")
}
