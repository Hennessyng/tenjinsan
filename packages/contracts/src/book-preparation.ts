import { z } from "zod"
import { BATCHED_VERIFICATION_VERSION } from "./batched-verification.ts"
import { batchedVerificationComplete } from "./batched-verification-results.ts"
import { BatchedVerificationState } from "./batched-verification-state.ts"
import { chapterFindings, synthesisFindings } from "./book-map-findings.ts"
import { COVERAGE_VERIFICATION_VERSION } from "./coverage-verification.ts"
import { preparationVerificationIssues, WholeBookVerification } from "./preparation-verification.ts"

export { bookMapProjection, chapterFindings, synthesisFindings } from "./book-map-findings.ts"

import { BookSynthesis, ChapterPartMap, PreparedRange } from "./book-map-model.ts"
import { Natural, Text } from "./primitives.ts"

export {
  BookSynthesis,
  ChapterPartMap,
  MappedFinding,
  PreparedRange,
  SourceSemanticDecision,
} from "./book-map-model.ts"
export { wholeBookCheckAccepted } from "./preparation-verification.ts"
export const WholeBookPreparation = z
  .strictObject({
    version: z.literal("whole-book-2"),
    preprocessingVersion: z.enum([
      "packed-unicode-2",
      "packed-capacity-3",
      "batched-capacity-4",
      "batched-room-5",
    ]),
    synthesisVersion: z.enum([
      "maps-original-check-2",
      COVERAGE_VERIFICATION_VERSION,
      BATCHED_VERIFICATION_VERSION,
    ]),
    capacityId: Text,
    phase: z.enum(["mapping", "synthesizing", "verifying", "blocked", "complete"]),
    groups: z
      .array(
        z
          .strictObject({
            id: Text,
            title: Text,
            provenance: z.enum(["heading", "structural"]),
            level: z.number().int().min(1).max(6).nullable(),
            parentId: Text.nullable(),
            ranges: z.array(PreparedRange).readonly(),
          })
          .readonly(),
      )
      .readonly(),
    parts: z
      .array(
        z
          .strictObject({
            id: Text,
            groupId: Text,
            ranges: z.array(PreparedRange).readonly(),
            status: z.enum(["unsent", "pending", "transmitted", "complete", "failed", "uncertain"]),
          })
          .readonly(),
      )
      .readonly(),
    maps: z.array(ChapterPartMap).readonly(),
    synthesis: BookSynthesis.nullable(),
    verification: z.array(WholeBookVerification).readonly(),
    batched: BatchedVerificationState.optional(),
    allowance: z
      .strictObject({
        cap: Natural,
        used: Natural,
        remaining: Natural,
        plannedAttempts: Natural,
        reservedLaterAttempts: Natural,
        uncertainCounts: z.literal(true),
      })
      .readonly(),
    limitations: z.array(Text).readonly(),
    terminal: z.literal("verified-analysis").optional(),
  })
  .superRefine((value, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: "custom", message })
    if (
      new Set(value.groups.map((group) => group.id)).size !== value.groups.length ||
      new Set(value.parts.map((part) => part.id)).size !== value.parts.length
    )
      invalid("duplicate preparation identity")
    for (const [index, group] of value.groups.entries()) {
      if (
        group.parentId &&
        !value.groups
          .slice(0, index)
          .some(
            (parent) =>
              parent.id === group.parentId &&
              parent.level !== null &&
              group.level !== null &&
              parent.level < group.level,
          )
      )
        invalid("foreign chapter parent")
      for (const range of group.ranges) {
        let cursor = range.start
        for (const part of value.parts.filter((part) => part.groupId === group.id))
          for (const piece of part.ranges.filter(
            (piece) => piece.blockId === range.blockId && piece.resourcePath === range.resourcePath,
          )) {
            if (piece.start !== cursor || piece.end <= piece.start || piece.end > range.end)
              invalid("gapped or overlapping source preparation")
            cursor = piece.end
          }
        if (cursor !== range.end) invalid("unplanned source range")
      }
    }
    for (const part of value.parts)
      if (
        !value.groups.some(
          (group) =>
            group.id === part.groupId &&
            part.ranges.every((piece) =>
              group.ranges.some(
                (range) =>
                  piece.resourcePath === range.resourcePath &&
                  piece.blockId === range.blockId &&
                  piece.start >= range.start &&
                  piece.end <= range.end,
              ),
            ),
        )
      )
        invalid("foreign prepared range")
    for (const map of value.maps) {
      const part = value.parts.find(
        (part) => part.id === map.partId && part.groupId === map.groupId,
      )
      if (
        !part ||
        chapterFindings(map).some((finding) =>
          finding.sources.some(
            (span) =>
              !part.ranges.some(
                (range) =>
                  span.resourcePath === range.resourcePath &&
                  span.blockId === range.blockId &&
                  span.start >= range.start &&
                  span.end <= range.end,
              ),
          ),
        )
      )
        invalid("chapter map exceeds prepared ranges")
      if (map.claimStatus === "no-claim" && map.claims.length > 0)
        invalid("no-claim map invents claims")
    }
    if (new Set(value.maps.map((map) => map.partId)).size !== value.maps.length)
      invalid("duplicate chapter-part map")
    const synthesis = value.synthesis
    if (synthesis) {
      if (
        JSON.stringify(synthesis.representedGroupIds) !==
        JSON.stringify(value.groups.map((group) => group.id))
      )
        invalid("synthesis omits chapter groups")
      const known = new Set(
        value.maps
          .flatMap(chapterFindings)
          .flatMap((finding) => finding.sources.map((span) => JSON.stringify(span))),
      )
      if (
        synthesisFindings(synthesis).some((finding) =>
          finding.sources.some((span) => !known.has(JSON.stringify(span))),
        )
      )
        invalid("synthesis invents evidence")
    }
    if (value.synthesisVersion === BATCHED_VERIFICATION_VERSION) {
      if (
        !value.batched ||
        value.verification.length > 0 ||
        value.batched.reserve.windowHashes.length !== value.parts.length
      )
        invalid("missing batched reserve/state")
      if (
        value.batched?.manifest &&
        (JSON.stringify(value.batched.manifest.maps) !== JSON.stringify(value.maps) ||
          JSON.stringify(value.batched.manifest.synthesis) !== JSON.stringify(value.synthesis))
      )
        invalid("foreign batched materialization")
      if (
        value.phase === "complete" &&
        (!value.batched?.manifest ||
          !batchedVerificationComplete(value.batched.manifest, value.batched.receipts))
      )
        invalid("incomplete batched verification")
    } else {
      if (value.batched) invalid("batched state on legacy preparation")
      for (const issue of preparationVerificationIssues(value)) invalid(issue)
    }
    if (
      value.phase === "complete" &&
      (value.parts.some((part) => part.status !== "complete") ||
        value.maps.length !== value.parts.length ||
        value.maps.some((map) => !map.complete) ||
        !synthesis?.complete)
    )
      invalid("whole-book completion is unverified")
  })
  .readonly()
export type WholeBookPreparation = z.infer<typeof WholeBookPreparation>
