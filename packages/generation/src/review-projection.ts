import {
  contentDigest,
  type LessonRevision,
  PublicationProjection,
  type SourceSpan,
} from "@reading-studio/contracts"
import type { SourceRepository } from "@reading-studio/storage"
import { attributionSources } from "./lesson-validation.ts"

export function lessonSources(lesson: LessonRevision): readonly SourceSpan[] {
  return [
    ...lesson.coverage.sources,
    ...lesson.sections.flatMap((section) => [
      ...attributionSources(section.attribution),
      ...(section.teaching?.sources.map((source) => source.span) ?? []),
      ...(section.teaching?.blocks.flatMap((block) => attributionSources(block.attribution)) ?? []),
      ...(section.teaching?.caveats.flatMap((caveat) => caveat.sources) ?? []),
      ...(section.teaching?.sceneNotes.flatMap((note) => attributionSources(note.attribution)) ??
        []),
    ]),
  ]
}

export function sourceLocator(span: SourceSpan): string {
  return `${span.resourcePath}#${span.blockId}:${span.start}-${span.end}`
}

function sourceQuotation(span: SourceSpan, sources: SourceRepository): string | undefined {
  if (span.originalFragment.length > 1000) return undefined
  const resource = sources
    .getNormalization(span.normalizationRevisionId)
    ?.resources.find((item) => item.path === span.resourcePath)
  if (resource?.status !== "included") return undefined
  const block = resource.blocks.find((item) => item.id === span.blockId)
  return block?.text.slice(span.start, span.end) === span.originalFragment
    ? span.originalFragment
    : undefined
}

export function buildReviewProjection(lesson: LessonRevision, sources: SourceRepository) {
  return PublicationProjection.parse({
    title: lesson.sections[0]?.title,
    bookMap: [
      ...new Set(lessonSources(lesson).map((span) => span.normalizationRevisionId)),
    ].flatMap((id) =>
      (sources.getNormalization(id)?.resources ?? [])
        .filter((resource) => resource.role === "main-chapter")
        .map((resource) => ({
          id: contentDigest(JSON.stringify([id, resource.path])),
          title: { en: resource.path, ja: resource.path },
          sectionIds: lesson.sections
            .filter((section) =>
              [
                ...attributionSources(section.attribution),
                ...(section.teaching?.sources.map((source) => source.span) ?? []),
              ].some(
                (span) =>
                  span.normalizationRevisionId === id && span.resourcePath === resource.path,
              ),
            )
            .map((section) => section.id),
        })),
    ),
    sections: lesson.sections.map((section) => {
      const teaching = section.teaching
      const copy = [
        section.content,
        ...(teaching?.blocks.flatMap((block) => [
          block.label,
          block.content,
          ...block.assumptions,
        ]) ?? []),
        ...(teaching?.caveats.map((caveat) => caveat.text) ?? []),
        ...(teaching?.sceneNotes.flatMap((note) => note.assumptions) ?? []),
      ]
      const spans =
        teaching?.sources.map((source) => source.span) ?? attributionSources(section.attribution)
      const unique = [
        ...new Map(spans.map((span) => [contentDigest(JSON.stringify(span)), span])).entries(),
      ]
      return {
        id: section.id,
        heading: section.title,
        content: {
          en: copy.map((pair) => pair.en).join("\n\n"),
          ja: copy.map((pair) => pair.ja).join("\n\n"),
        },
        sourceNotes: unique.map(([id, span]) => ({
          id,
          title: {
            en: sources.getEdition(span.editionId)?.title ?? "Unavailable source",
            ja: sources.getEdition(span.editionId)?.title ?? "出典を確認できません",
          },
          locator: sourceLocator(span),
          ...(sourceQuotation(span, sources) === undefined
            ? {}
            : { quotation: span.originalFragment }),
          note: {
            en: "Source passage; support requires separate review.",
            ja: "出典の一節。主張の裏付けは別途確認が必要です。",
          },
        })),
        scenes: section.scenes,
        practice: section.practice,
      }
    }),
    assets: [],
  })
}
