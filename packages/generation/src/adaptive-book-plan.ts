import type { NormalizationRevision, StudySetupRevision } from "@reading-studio/contracts"
import type { VerifiedRouteCapacity } from "@reading-studio/providers"
import type { SourceWindow } from "./book-map-output.ts"
import { bookMapRequestsFit } from "./book-map-request.ts"
import { wholeBookAllowance } from "./whole-book-budget.ts"
import { wholeBookGroups } from "./whole-book-scope.ts"

export const ADAPTIVE_PREPROCESSING_VERSION = "packed-capacity-3"
export type AdaptivePlanInput = {
  readonly setup: StudySetupRevision
  readonly normalization: NormalizationRevision
  readonly capacity: VerifiedRouteCapacity
  readonly cap: number
  readonly used: number
  readonly additionalWindowFits?: (window: SourceWindow) => boolean
  readonly verification?: {
    readonly version: "batched-original-check-4"
    readonly maxFindingBatches: number
  }
}

export async function adaptiveBookPlan(input: AdaptivePlanInput): Promise<
  | { readonly kind: "ready"; readonly windows: readonly SourceWindow[] }
  | {
      readonly kind: "limited"
      readonly reason: "capacity-limit" | "attempt-budget-limit"
      readonly requiredWindows: number
    }
> {
  const windows: SourceWindow[] = []
  for (const group of wholeBookGroups(input.setup, input.normalization)) {
    let pending: SourceWindow[] = []
    const window = (ranges: readonly SourceWindow[]): SourceWindow => {
      const first = ranges[0]
      if (!first) throw new TypeError("Empty adaptive part")
      return {
        ...first,
        groupId: group.id,
        ranges,
        text: ranges.map((range) => range.text).join(""),
      }
    }
    const fits = async (ranges: readonly SourceWindow[]) => {
      const part = window(ranges)
      return (
        (await bookMapRequestsFit({ ...input, windows: [part] })) &&
        (input.additionalWindowFits?.(part) ?? true)
      )
    }
    const flush = () => {
      if (pending.length > 0) windows.push(window(pending))
      pending = []
    }
    for (const range of group.ranges) {
      let start = range.start
      while (start < range.end) {
        const allowance = wholeBookAllowance({
          windows: windows.length + 1,
          cap: input.cap,
          used: input.used,
          ...(input.setup.analysis.purpose ? { purpose: input.setup.analysis.purpose } : {}),
          ...(input.verification ? { verification: input.verification } : {}),
        })
        if (allowance.plannedAttempts > allowance.remaining)
          return {
            kind: "limited",
            reason: "attempt-budget-limit",
            requiredWindows: windows.length + 1,
          }
        const piece = (end: number) => ({
          ...range,
          start,
          end,
          text: range.text.slice(start - range.start, end - range.start),
        })
        if (await fits([...pending, piece(range.end)])) {
          pending.push(piece(range.end))
          start = range.end
          continue
        }
        const boundaries = [start]
        for (const scalar of range.text.slice(start - range.start))
          boundaries.push((boundaries.at(-1) ?? start) + scalar.length)
        const firstNonBlank = range.text.slice(start - range.start).search(/\S/u)
        const minimumIndex =
          input.additionalWindowFits && pending.length === 0 && firstNonBlank >= 0
            ? boundaries.findIndex((end) => end > start + firstNonBlank)
            : 1
        const minimum = boundaries[minimumIndex]
        if (minimum === undefined) throw new TypeError("Missing Unicode scalar")
        if (!(await fits([...pending, piece(minimum)]))) {
          if (pending.length > 0) {
            flush()
            continue
          }
          return { kind: "limited", reason: "capacity-limit", requiredWindows: windows.length + 1 }
        }
        let best = minimum
        let low = minimumIndex + 1
        let high = boundaries.length - 2
        while (low <= high) {
          const middle = Math.floor((low + high) / 2)
          const end = boundaries[middle]
          if (end === undefined) throw new TypeError("Missing source boundary")
          if (await fits([...pending, piece(end)])) {
            best = end
            low = middle + 1
          } else high = middle - 1
        }
        pending.push(piece(best))
        flush()
        start = best
      }
    }
    flush()
  }
  return { kind: "ready", windows }
}

export function storedBookPlan(windows: readonly SourceWindow[]) {
  return windows.map((window) => ({
    groupId: window.groupId,
    ranges: (window.ranges ?? [window]).map(({ resourcePath, blockId, start, end }) => ({
      resourcePath,
      blockId,
      start,
      end,
    })),
  }))
}
