import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { LocalSubscriptionAdapter, type ProviderReceipt } from "@reading-studio/providers"
import { vi } from "vitest"
import type { analysisPurposeFixture } from "./analysis-purpose-fixture.ts"
import { BatchedRuntimeAdapter } from "./whole-book-batch-runtime-fixture.ts"

export function analysisNativeReplies(
  item: Awaited<ReturnType<typeof analysisPurposeFixture>>,
  options: { readonly repairFirst?: boolean; readonly lose?: number } = {},
) {
  const native = LocalSubscriptionAdapter.prototype.dispatch,
    authored = new BatchedRuntimeAdapter()
  let pending: ProviderReceipt | undefined,
    repaired = false,
    lost = 0
  return vi
    .spyOn(LocalSubscriptionAdapter.prototype, "dispatch")
    .mockImplementation(async function (this: LocalSubscriptionAdapter, request) {
      const result = request.schemaRepair && pending ? pending : await authored.dispatch(request)
      if (result.kind !== "output") throw new TypeError("Missing authored native response")
      pending = result
      const text = options.repairFirst && !repaired && !request.schemaRepair ? "{}" : result.text
      if (options.repairFirst && !repaired) repaired = true
      const control = join(item.fixture.directory, "managed-control")
      writeFileSync(join(control, "responses.json"), JSON.stringify([JSON.parse(text)]))
      writeFileSync(join(control, "cursor"), "0")
      const output = await native.call(this, request)
      if (lost < (options.lose ?? 0)) {
        lost++
        const { ProviderError } = await import("@reading-studio/providers")
        throw new ProviderError("outcome-unknown")
      }
      return output
    })
}
