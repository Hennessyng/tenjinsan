import { z } from "zod"
import { contentDigest } from "./identity.ts"
import { Bilingual, ContentId, Digest, Text, uniqueItems } from "./primitives.ts"
import { Practice, practiceTeachingStates, requiredTeachingStates, SceneSpec } from "./scenes.ts"

export const PublicationAsset = z
  .strictObject({
    id: ContentId,
    contentHash: Digest,
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "font/woff2"]),
    alt: Bilingual,
    license: Text,
  })
  .readonly()
export const PublicSourceNote = z
  .strictObject({
    id: ContentId,
    title: Bilingual,
    locator: Text,
    quotation: z.string().min(1).max(1000).optional(),
    note: Bilingual,
  })
  .readonly()
export const PublicationSection = z
  .strictObject({
    id: ContentId,
    heading: Bilingual,
    content: Bilingual,
    sourceNotes: uniqueItems(PublicSourceNote),
    scenes: uniqueItems(SceneSpec),
    practice: uniqueItems(Practice),
  })
  .readonly()
export const PublicationProjection = z
  .strictObject({
    title: Bilingual,
    sections: uniqueItems(PublicationSection).refine((sections) => sections.length > 0),
    assets: uniqueItems(PublicationAsset),
    bookMap: uniqueItems(
      z
        .strictObject({
          id: ContentId,
          title: Bilingual,
          sectionIds: z.array(ContentId).readonly(),
        })
        .readonly(),
    ).optional(),
  })
  .refine((projection) => {
    const scenes = projection.sections.flatMap((section) => section.scenes.map((scene) => scene.id))
    return (
      new Set(scenes).size === scenes.length &&
      !scenes.some((id) =>
        projection.sections.some((section) => section.id.toString() === id.toString()),
      ) &&
      (projection.bookMap ?? []).every(
        (chapter) =>
          new Set(chapter.sectionIds).size === chapter.sectionIds.length &&
          chapter.sectionIds.every((id) =>
            projection.sections.some((section) => section.id === id),
          ),
      )
    )
  }, "duplicate projection state namespace")
  .readonly()
export type PublicationProjection = z.infer<typeof PublicationProjection>
export function projectionHash(projection: PublicationProjection): Digest {
  return contentDigest(JSON.stringify(PublicationProjection.parse(projection)))
}
export function publicationTeachingStateIds(projection: PublicationProjection) {
  return Object.freeze(
    projection.sections.flatMap((section) => [
      ...section.scenes.flatMap((scene) => requiredTeachingStates(scene).map((state) => state.id)),
      ...practiceTeachingStates(section.practice, section.id).map((state) => state.id),
    ]),
  )
}
export const ProjectionString = z.strictObject({ path: z.string(), text: z.string() }).readonly()
export type ProjectionString = z.infer<typeof ProjectionString>
export function projectedStrings(projection: PublicationProjection): readonly ProjectionString[] {
  const visit = (value: unknown, path: string): readonly ProjectionString[] => {
    if (typeof value === "string") return [Object.freeze({ path, text: value })]
    if (Array.isArray(value))
      return value.flatMap((item: unknown, index: number) => visit(item, `${path}/${index}`))
    if (typeof value === "object" && value !== null)
      return Object.entries(value).flatMap(([key, item]: [string, unknown]) =>
        visit(item, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`),
      )
    return []
  }
  return Object.freeze(visit(projection, ""))
}
