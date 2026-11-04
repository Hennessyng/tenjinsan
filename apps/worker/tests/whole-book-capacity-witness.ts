import {
  BookSynthesis,
  ChapterPartMap,
  COVERAGE_VERIFICATION_VERSION,
  ContentId,
  CoverageVerificationTarget,
  chapterFindings,
  type NormalizationRevision,
  SourceSpan,
  type StudySetupRevision,
  synthesisFindings,
  WindowOriginal,
} from "@reading-studio/contracts"
import { coverageTargetStage, prepareBookMapScope } from "@reading-studio/generation"
import {
  bookSourcePayload,
  legacyLocalReservationBytes as localRequestBytes,
  reviewedSourceBlocks,
  sourceRangesInput,
  structuredRequest,
  type VerifiedRouteCapacity,
} from "@reading-studio/providers"
import { z } from "zod"
import { capacityOutputFrames } from "./whole-book-capacity-outputs.ts"

export function coverageCapacityWitness(input: {
  readonly setup: StudySetupRevision
  readonly normalization: NormalizationRevision
  readonly capacity: VerifiedRouteCapacity
}) {
  const planned = prepareBookMapScope(input.setup, input.normalization)
  if (planned.kind !== "ready") throw new TypeError("Witness requires an actual default plan")
  const window = planned.windows[0]
  if (!window) throw new TypeError("Missing default window")
  const rows = sourceRangesInput(
    reviewedSourceBlocks(input.setup, input.normalization),
    window.ranges ?? [window],
  )
  const first = rows[0]
  const scalar = first?.text[Symbol.iterator]().next().value
  if (!first || !scalar) throw new TypeError("Missing original scalar")
  const source = SourceSpan.parse({
    editionId: input.setup.editionId,
    normalizationRevisionId: input.normalization.id,
    resourcePath: first.resourcePath,
    blockId: first.blockId,
    start: first.start,
    end: first.start + scalar.length,
    originalFragment: scalar,
    ...(first.pageLabel ? { pageLabel: first.pageLabel } : {}),
  })
  const citation = {
    resourcePath: source.resourcePath,
    blockId: source.blockId,
    start: source.start,
    end: source.end,
  }
  const frames = capacityOutputFrames({
    citation,
    groupIds: planned.groups?.map((group) => group.id) ?? [],
  })
  const { chapter, synthesis, statement } = frames
  const partId = `wb-${"0".repeat(64)}`
  const linked = (item: { readonly text: string }, id: string) => ({
    id: ContentId.parse(id),
    text: item.text,
    sources: [source],
  })
  const map = ChapterPartMap.parse({
    partId,
    groupId: window.groupId,
    complete: true,
    claimStatus: chapter.claimStatus,
    purpose: linked(statement, `${partId}-purpose-0`),
    summary: linked(statement, `${partId}-summary-0`),
    ...Object.fromEntries(
      (
        [
          "claims",
          "concepts",
          "definitions",
          "examples",
          "qualifications",
          "uncertainties",
        ] as const
      ).map((field) => [
        field,
        chapter[field].map((item, index) => linked(item, `${partId}-${field}-${index}`)),
      ]),
    ),
  })
  const global = BookSynthesis.parse({
    strategy: "complete-maps",
    complete: true,
    representedGroupIds: synthesis.representedGroupIds,
    ...Object.fromEntries(
      (
        [
          "thesis",
          "progression",
          "connections",
          "conflicts",
          "changesOfPosition",
          "uncertainties",
        ] as const
      ).map((field) => [
        field,
        synthesis[field].map((item, index) => linked(item, `${partId}-syn-${field}-${index}`)),
      ]),
    ),
  })
  const target = CoverageVerificationTarget.parse({
    version: COVERAGE_VERIFICATION_VERSION,
    kind: "window",
    map,
    synthesis: global,
    originals: rows.map((row) =>
      WindowOriginal.parse({
        editionId: input.setup.editionId,
        normalizationRevisionId: input.normalization.id,
        resourcePath: row.resourcePath,
        blockId: row.blockId,
        start: row.start,
        end: row.end,
        originalFragment: row.text,
        ...(row.pageLabel ? { pageLabel: row.pageLabel } : {}),
      }),
    ),
  })
  const build = (candidate: CoverageVerificationTarget, originals: typeof rows) => {
    const stage = coverageTargetStage(candidate, input.capacity, [])
    return structuredRequest({
      model: input.setup.analysis.model,
      settings: input.setup.analysis.settings,
      instruction: stage.instruction,
      schema: z.toJSONSchema(stage.schema, { reused: "ref" }),
      blocks: [...(stage.derivedData ?? []), ...bookSourcePayload(originals)],
      signal: new AbortController().signal,
    })
  }
  const request = build(target, rows)
  const minimumTarget = CoverageVerificationTarget.parse({ ...target, originals: [source] })
  const minimum = build(minimumTarget, [{ ...first, end: source.end, text: scalar }])
  return {
    plannedWindows: planned.windows.length,
    firstWindowSourceUnits: rows.reduce((sum, row) => sum + row.text.length, 0),
    declaredBound:
      "transport-admitted rich outputs:2000 UTF16 units per text,10 findings per reply,one valid source citation; no token-to-byte assertion",
    transport: frames.transport,
    schemaOnly: frames.schemaOnly,
    mapFindings: chapterFindings(map).length,
    synthesisFindings: synthesisFindings(global).length,
    declaredMaxOutputTokens: input.setup.analysis.settings.maxOutputTokens,
    mapReplyUtf8: Buffer.byteLength(JSON.stringify(chapter)),
    synthesisReplyUtf8: Buffer.byteLength(JSON.stringify(synthesis)),
    measuredRequestBytes: localRequestBytes("chatgpt-subscription", request),
    schemaBytes: Buffer.byteLength(JSON.stringify(request.schema)),
    minimumOriginalRequestBytes: localRequestBytes("chatgpt-subscription", minimum),
    minimumOriginalUnits: scalar.length,
    instructionBytes: Buffer.byteLength(
      coverageTargetStage(target, input.capacity, []).instruction,
    ),
    outputTokenByteBound: "UNPROVEN",
  }
}
