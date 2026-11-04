import {
  ChapterPartMap,
  ContentId,
  chapterFindings,
  contentDigest,
  SourceSpan,
  VERIFICATION_ROOM_BYTES,
  VERIFICATION_ROOM_PREPROCESSING_VERSION,
  VERIFICATION_ROOM_SAMPLE_FINDING_UNITS,
  VERIFICATION_ROOM_SAMPLE_FINDINGS,
  type WindowOriginal,
} from "@reading-studio/contracts"
import {
  legacyLocalReservationBytes as localRequestBytes,
  ProviderError,
  requestFitsCapacity,
} from "@reading-studio/providers"
import {
  type BatchExecution,
  batchTarget,
  batchVerificationRequest,
} from "./batched-verification-request.ts"
import type { SourceWindow } from "./book-map-output.ts"

export function plannedWindowOriginals(
  originals: readonly WindowOriginal[],
  ranges: readonly SourceWindow[],
) {
  return ranges.map((range) => {
    const original = originals.find(
      (span) => span.resourcePath === range.resourcePath && span.blockId === range.blockId,
    )
    if (!original) throw new TypeError("Foreign verification-room original")
    return {
      ...original,
      start: range.start,
      end: range.end,
      originalFragment: original.originalFragment.slice(range.start, range.end),
    }
  })
}

export function verificationRoomAssessment(
  execution: BatchExecution,
  scope: { readonly originals: readonly WindowOriginal[]; readonly groupId: string },
) {
  const original = scope.originals.find((span) => /\S/u.test(span.originalFragment))
  if (!original) return { fits: false as const, measurements: null }
  const offset = original.originalFragment.search(/\S/u)
  const scalar = original.originalFragment.codePointAt(offset)
  if (scalar === undefined) throw new TypeError("Missing verification-room scalar")
  const units = scalar > 0xffff ? 2 : 1
  const source = SourceSpan.parse({
    ...original,
    start: original.start + offset,
    end: original.start + offset + units,
    originalFragment: original.originalFragment.slice(offset, offset + units),
  })
  const partId = `wb-${contentDigest("verification-room-map-reference-1")}`
  const statement = (kind: string) => ({
    id: ContentId.parse(`${partId}-${kind}-0`),
    text: "Synthetic interpretation with a qualification.",
    sources: [source],
  })
  const map = ChapterPartMap.parse({
    partId,
    groupId: scope.groupId,
    complete: true,
    claimStatus: "claims",
    purpose: statement("purpose"),
    claims: [statement("claim")],
    concepts: [],
    definitions: [],
    examples: [],
    qualifications: [statement("qualification")],
    uncertainties: [],
    summary: statement("summary"),
  })
  const mapFindings = chapterFindings(map)
  const findings = Array.from({ length: VERIFICATION_ROOM_SAMPLE_FINDINGS }, (_, index) => ({
    id: ContentId.parse(
      `wb-${contentDigest("verification-room-synthesis-reference-1")}-${index === 0 ? "thesis-0" : `progression-${index - 1}`}`,
    ),
    text: String(index).repeat(VERIFICATION_ROOM_SAMPLE_FINDING_UNITS),
    sources: [source],
  }))
  const reserve = { id: contentDigest(VERIFICATION_ROOM_PREPROCESSING_VERSION) }
  const roots = {
    mapsHash: contentDigest(JSON.stringify(map)),
    synthesisHash: contentDigest(JSON.stringify(findings)),
  }
  const target = (kind: "map-omission" | "window-findings", entries: typeof mapFindings) =>
    batchTarget(reserve, roots, {
      kind,
      originals: scope.originals,
      windowHash: contentDigest(JSON.stringify(scope.originals)),
      batchHash: kind === "window-findings" ? contentDigest(JSON.stringify(entries)) : null,
      findings: entries,
    })
  const request = (kind: "map-omission" | "window-findings", entries: typeof mapFindings) =>
    batchVerificationRequest(execution, {
      target: target(kind, entries),
      findings: entries,
      ...(kind === "map-omission" ? { map } : {}),
    })
  const measure = (value: ReturnType<typeof request>) => {
    const bytes = localRequestBytes("chatgpt-subscription", value)
    let inputTokens: number
    try {
      inputTokens = execution.capacity.countInputTokens(value)
    } catch (error) {
      if (error instanceof Error) throw new ProviderError("capacity-unknown")
      throw error
    }
    return {
      bytes,
      inputTokens,
      freeBytes: Math.min(32000, execution.capacity.maxRequestBytes) - bytes,
      freeInputTokens:
        execution.capacity.contextTokens - value.settings.maxOutputTokens - inputTokens,
      fits: requestFitsCapacity(value, bytes, execution.capacity),
    }
  }
  const emptyMap = measure(request("map-omission", []))
  const emptyFindings = measure(request("window-findings", []))
  const representativeMap = measure(request("map-omission", mapFindings))
  const representativeFindings = measure(request("window-findings", findings))
  return {
    fits:
      scope.originals.reduce((sum, span) => sum + span.originalFragment.length, 0) <= 32000 &&
      emptyMap.fits &&
      emptyFindings.fits &&
      emptyMap.freeBytes >= VERIFICATION_ROOM_BYTES &&
      emptyFindings.freeBytes >= VERIFICATION_ROOM_BYTES &&
      representativeMap.fits &&
      representativeFindings.fits,
    measurements: {
      policy: VERIFICATION_ROOM_PREPROCESSING_VERSION,
      reservedBytes: VERIFICATION_ROOM_BYTES,
      emptyMap,
      emptyFindings,
      representativeMap,
      representativeFindings,
    },
  }
}
