import {
  chapterFindings,
  contentDigest,
  type SourceSemanticDecision,
  synthesisFindings,
} from "@reading-studio/contracts"
import type { StructuredStage } from "@reading-studio/providers"
import { BookMapError } from "./book-map-output.ts"
import { originalContext } from "./original-context.ts"
import type { WholeBookContext } from "./whole-book-context.ts"
import {
  ChapterOutput,
  chapterWireSchema,
  linkChapter,
  linkedStatement,
  SynthesisOutput,
  VerificationOutput,
  wholeBookInstructions,
} from "./whole-book-output.ts"
import { groupMetadata } from "./whole-book-scope.ts"

export function completedMaps(context: WholeBookContext) {
  return context.scope.windows.flatMap((window, index) => {
    const output = context.output("map", ChapterOutput, index)
    if (!output || !window.groupId) return []
    return [
      linkChapter({
        output: output.data,
        partId: context.id("map", index),
        groupId: window.groupId,
        setup: context.setup,
        ranges: window.ranges ?? [window],
      }),
    ]
  })
}

export function completedSynthesis(context: WholeBookContext) {
  const output = context.output("synthesis", SynthesisOutput)
  if (!output) return null
  const maps = completedMaps(context)
  const known = maps.flatMap(chapterFindings).flatMap((finding) => finding.sources)
  const ranges = context.approved
  const link = (
    kind:
      | "thesis"
      | "progression"
      | "connections"
      | "conflicts"
      | "changesOfPosition"
      | "uncertainties",
  ) =>
    output.data[kind].map((statement, index) => {
      for (const citation of statement.citations)
        if (
          !known.some(
            (span) =>
              span.resourcePath === citation.resourcePath &&
              span.blockId === citation.blockId &&
              span.start === citation.start &&
              span.end === citation.end,
          )
        )
          throw new BookMapError("invalid-citation")
      return linkedStatement({
        statement,
        id: `${context.id("synthesis")}-${kind}-${index}`,
        setup: context.setup,
        editionId: context.setup.editionId,
        ranges,
      })
    })
  if (
    JSON.stringify(output.data.representedGroupIds) !==
    JSON.stringify(context.scope.groups?.map((group) => group.id))
  )
    throw new BookMapError("invalid-citation")
  return {
    strategy: output.strategy ?? "complete-maps",
    complete: output.data.complete,
    representedGroupIds: output.data.representedGroupIds,
    thesis: link("thesis"),
    progression: link("progression"),
    connections: link("connections"),
    conflicts: link("conflicts"),
    changesOfPosition: link("changesOfPosition"),
    uncertainties: link("uncertainties"),
  }
}

export function verificationTargets(context: WholeBookContext) {
  const maps = completedMaps(context)
  const synthesis = completedSynthesis(context)
  return [...maps.map(chapterFindings), ...(synthesis ? [synthesisFindings(synthesis)] : [])]
}

export function completedVerification(context: WholeBookContext) {
  return verificationTargets(context).flatMap((findings, index) => {
    const output = context.output("verify", VerificationOutput, index)
    if (!output) return []
    const ids = findings.map((finding) => finding.id)
    if (
      output.data.decisions.length !== ids.length ||
      new Set(output.data.decisions.map((item) => item.id)).size !== ids.length ||
      !output.data.decisions.every((item) => ids.some((id) => id === item.id))
    )
      throw new BookMapError("invalid-citation")
    const decisions: readonly SourceSemanticDecision[] = output.data.decisions.map((item) => {
      const finding = findings.find((finding) => finding.id === item.id)
      if (!finding) throw new BookMapError("invalid-citation")
      return { ...item, id: finding.id }
    })
    return [
      {
        id: context.id("verify", index),
        targetHash: contentDigest(JSON.stringify(findings)),
        decisions,
      },
    ]
  })
}

export function wholeBookStage(context: WholeBookContext, jobId: string): StructuredStage {
  for (const [index, window] of context.scope.windows.entries())
    if (jobId === context.id("map", index)) {
      const ranges = window.ranges ?? [window]
      const group = context.scope.groups?.find((group) => group.id === window.groupId)
      if (!group) throw new BookMapError("foreign-job")
      return {
        processingStep: "chapter-map",
        wireSchema: chapterWireSchema,
        schema: ChapterOutput.superRefine((output, ctx) => {
          try {
            linkChapter({
              output,
              setup: context.setup,
              partId: context.id("map", index),
              groupId: window.groupId ?? "",
              ranges,
            })
          } catch (error) {
            if (error instanceof BookMapError) ctx.addIssue({ code: "custom", message: error.code })
            else throw error
          }
        }),
        sourceRanges: ranges,
        derivedData: [
          { kind: "chapter-map", groupId: window.groupId, group: groupMetadata(group) },
        ],
        instruction: wholeBookInstructions.map,
        capacity: context.capacity,
      }
    }
  const maps = completedMaps(context)
  if (maps.length !== context.scope.windows.length || maps.some((map) => !map.complete))
    throw new BookMapError("foreign-job")
  if (jobId === context.id("synthesis"))
    return {
      processingStep: "book-synthesis",
      schema: SynthesisOutput.superRefine((output, ctx) => {
        if (
          JSON.stringify(output.representedGroupIds) !==
          JSON.stringify(context.scope.groups?.map((group) => group.id))
        )
          ctx.addIssue({ code: "custom", message: "incomplete group coverage" })
        const spans = maps.flatMap(chapterFindings).flatMap((finding) => finding.sources)
        for (const finding of [
          ...output.thesis,
          ...output.progression,
          ...output.connections,
          ...output.conflicts,
          ...output.changesOfPosition,
          ...output.uncertainties,
        ])
          for (const citation of finding.citations)
            if (
              !spans.some(
                (span) =>
                  span.resourcePath === citation.resourcePath &&
                  span.blockId === citation.blockId &&
                  span.start === citation.start &&
                  span.end === citation.end,
              )
            )
              ctx.addIssue({ code: "custom", message: "foreign synthesis evidence" })
      }),
      sourceRanges: [],
      includeOriginalWhenFits: true,
      derivedData: [
        {
          kind: "book-synthesis",
          groupIds: context.scope.groups?.map((group) => group.id),
          groups: context.scope.groups?.map(groupMetadata),
          maps,
        },
      ],
      instruction: wholeBookInstructions.synthesis,
      capacity: context.capacity,
    }
  const targets = verificationTargets(context)
  for (const [index, findings] of targets.entries())
    if (jobId === context.id("verify", index)) {
      const qualifications = maps.flatMap((map) => map.qualifications)
      return {
        processingStep: "original-verification",
        schema: VerificationOutput.superRefine((output, ctx) => {
          const ids = new Set(output.decisions.map((item) => item.id))
          if (
            ids.size !== findings.length ||
            output.decisions.length !== findings.length ||
            !findings.every((finding) => ids.has(finding.id))
          )
            ctx.addIssue({ code: "custom", message: "missing or foreign semantic verdict" })
        }),
        sourceRanges: originalContext(context, [...findings, ...qualifications]),
        derivedData: [{ kind: "original-verification", interpretations: findings, qualifications }],
        instruction: wholeBookInstructions.verify,
        capacity: context.capacity,
      }
    }
  throw new BookMapError("foreign-job")
}
