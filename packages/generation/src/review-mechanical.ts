import {
  contentDigest,
  type LessonRevision,
  LocatedSourceSpan,
  type PublicationProjection,
} from "@reading-studio/contracts"
import type { SourceRepository } from "@reading-studio/storage"
import { lessonSources, sourceLocator } from "./review-projection.ts"

export function mechanicalReview(input: {
  readonly lesson: LessonRevision
  readonly projection: PublicationProjection
  readonly sources: SourceRepository
}) {
  const findings: {
    readonly path: string
    readonly category: "broken-locator" | "unsupported-quotation"
  }[] = []
  const passages = new Map<
    string,
    { readonly text: string; readonly locator: string; readonly title: string }
  >()
  for (const [index, span] of lessonSources(input.lesson).entries()) {
    const path = `/lesson/sources/${index}`
    const normalization = input.sources.getNormalization(span.normalizationRevisionId)
    const located = LocatedSourceSpan.safeParse({ normalization, span })
    const edition = input.sources.getEdition(span.editionId)
    if (!located.success || !edition) {
      findings.push({ path, category: "broken-locator" })
      continue
    }
    const resource = located.data.normalization.resources.find(
      (item) => item.path === span.resourcePath,
    )
    const block =
      resource?.status === "included"
        ? resource.blocks.find((item) => item.id === span.blockId)
        : undefined
    const text = block?.text.slice(span.start, span.end) ?? ""
    if (
      text !== span.originalFragment &&
      (block?.originalFragment ?? resource?.path) !== span.originalFragment
    )
      findings.push({ path, category: "unsupported-quotation" })
    passages.set(contentDigest(JSON.stringify(span)), {
      text,
      locator: sourceLocator(span),
      title: edition.title,
    })
  }
  for (const [sectionIndex, section] of input.projection.sections.entries()) {
    for (const [noteIndex, note] of section.sourceNotes.entries()) {
      const path = `/sections/${sectionIndex}/sourceNotes/${noteIndex}`
      const passage = passages.get(note.id)
      if (
        !passage ||
        note.locator !== passage.locator ||
        note.title.en !== passage.title ||
        note.title.ja !== passage.title
      )
        findings.push({ path, category: "broken-locator" })
      else if (note.quotation !== undefined && !passage.text.includes(note.quotation))
        findings.push({ path, category: "unsupported-quotation" })
    }
  }
  for (const [sectionIndex, section] of input.lesson.sections.entries()) {
    for (const [index, source] of (section.teaching?.sources ?? []).entries()) {
      const passage = passages.get(contentDigest(JSON.stringify(source.span)))
      if (passage && passage.text !== source.text)
        findings.push({
          path: `/lesson/sections/${sectionIndex}/sources/${index}`,
          category: "unsupported-quotation",
        })
    }
  }
  return findings
}
