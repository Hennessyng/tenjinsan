import {
  FullBookTestError,
  FullBookTestSession,
  fullBookTestMapRequest,
  measureFullBookTestPayload,
  planFullBookTest,
  type WindowOriginal,
} from "@reading-studio/contracts"
import { localToolInput } from "@reading-studio/providers"
import { serializeRpcFrame } from "@reading-studio/storage"

export function packFullBookTest(
  value: FullBookTestSession,
  wire: Readonly<{ threadId: string; rpcId: number; setupBytes?: number }>,
): FullBookTestSession {
  const session = FullBookTestSession.parse(value)
  const packed: WindowOriginal[][] = [],
    pending = [...session.input.windows.flat()]
  let current: WindowOriginal[] = []
  const trial = (candidate: readonly WindowOriginal[], remaining: readonly WindowOriginal[]) => {
    const input = {
      ...session.input,
      windows: [...packed, candidate, ...(remaining.length ? [remaining] : [])],
    }
    return FullBookTestSession.parse({ ...session, input, plan: planFullBookTest(input) })
  }
  const fits = (candidate: readonly WindowOriginal[], remaining: readonly WindowOriginal[]) => {
    const proposed = trial(candidate, remaining)
    const { request, target } = fullBookTestMapRequest(proposed, packed.length)
    const frame = serializeRpcFrame({
      provider: "chatgpt-subscription",
      id: wire.rpcId + packed.length,
      method: "turn/start",
      params: { threadId: wire.threadId, ...localToolInput("chatgpt-subscription", request) },
      binding: target.hash,
    })
    try {
      if (frame.bytes + (wire.setupBytes ?? 0) > session.input.policy.maxAppBytes)
        throw new FullBookTestError("bytes")
      measureFullBookTestPayload(proposed.input, {
        kind: "application-request",
        serialized: frame.serialized,
      })
      return true
    } catch (error) {
      if (error instanceof FullBookTestError && error.reason === "bytes") return false
      throw error
    }
  }
  while (pending.length > 0) {
    const original = pending.shift()
    if (!original) throw new FullBookTestError("source")
    if (fits([...current, original], pending)) {
      current.push(original)
      continue
    }
    if (current.length > 0) {
      packed.push(current)
      current = []
      pending.unshift(original)
      continue
    }
    const offsets = [0]
    let offset = 0
    for (const scalar of original.originalFragment) {
      offset += scalar.length
      offsets.push(offset)
    }
    let low = 1,
      high = offsets.length - 1,
      selected = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2),
        size = offsets[middle]
      if (size === undefined) throw new FullBookTestError("source")
      const prefix = {
        ...original,
        end: original.start + size,
        originalFragment: original.originalFragment.slice(0, size),
      }
      const suffix = {
        ...original,
        start: original.start + size,
        originalFragment: original.originalFragment.slice(size),
      }
      if (fits([prefix], [...(suffix.originalFragment ? [suffix] : []), ...pending])) {
        selected = size
        low = middle + 1
      } else high = middle - 1
    }
    if (selected === 0) throw new FullBookTestError("bytes")
    current.push({
      ...original,
      end: original.start + selected,
      originalFragment: original.originalFragment.slice(0, selected),
    })
    if (selected < original.originalFragment.length)
      pending.unshift({
        ...original,
        start: original.start + selected,
        originalFragment: original.originalFragment.slice(selected),
      })
  }
  if (current.length > 0) packed.push(current)
  const input = { ...session.input, windows: packed }
  return FullBookTestSession.parse({ ...session, input, plan: planFullBookTest(input) })
}
