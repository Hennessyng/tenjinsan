import { z } from "zod"

export const Text = z
  .string()
  .min(1)
  .max(100_000)
  .refine((value) => value.trim().length > 0)
export const Bilingual = z.strictObject({ en: Text, ja: Text }).readonly()
export type Bilingual = z.infer<typeof Bilingual>
export const Digest = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand<"Digest">()
export type Digest = z.infer<typeof Digest>
const Identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)
export const EditionId = Identifier.brand<"EditionId">()
export const NormalizationRevisionId = Identifier.brand<"NormalizationRevisionId">()
export const BlockId = Identifier.brand<"BlockId">()
export const StudyId = Identifier.brand<"StudyId">()
export const SetupRevisionId = Identifier.brand<"SetupRevisionId">()
export const AnalysisRevisionId = Identifier.brand<"AnalysisRevisionId">()
export const QuestionId = Identifier.brand<"QuestionId">()
export const QuestionRevisionId = Identifier.brand<"QuestionRevisionId">()
export const OptionId = Identifier.brand<"OptionId">()
export const BriefRevisionId = Identifier.brand<"BriefRevisionId">()
export const OutlineRevisionId = Identifier.brand<"OutlineRevisionId">()
export const LessonRevisionId = Identifier.brand<"LessonRevisionId">()
export const PublicationRevisionId = Identifier.brand<"PublicationRevisionId">()
export const PrivacyReviewId = Identifier.brand<"PrivacyReviewId">()
export const GrantId = Identifier.brand<"GrantId">()
export const InstallationId = Identifier.brand<"InstallationId">()
export const OwnerId = Identifier.brand<"OwnerId">()
export const SceneId = Identifier.brand<"SceneId">()
export const ContentId = Identifier.brand<"ContentId">()
export const RunId = Identifier.brand<"RunId">()
export const AttemptId = Identifier.brand<"AttemptId">()
export const JobId = Identifier.brand<"JobId">()
export const ArtifactId = Identifier.brand<"ArtifactId">()
export const InputRevisionId = Identifier.brand<"InputRevisionId">()
export type EditionId = z.infer<typeof EditionId>
export type NormalizationRevisionId = z.infer<typeof NormalizationRevisionId>
export type BlockId = z.infer<typeof BlockId>
export type StudyId = z.infer<typeof StudyId>
export type SetupRevisionId = z.infer<typeof SetupRevisionId>
export type AnalysisRevisionId = z.infer<typeof AnalysisRevisionId>
export type QuestionId = z.infer<typeof QuestionId>
export type QuestionRevisionId = z.infer<typeof QuestionRevisionId>
export type OptionId = z.infer<typeof OptionId>
export type BriefRevisionId = z.infer<typeof BriefRevisionId>
export type OutlineRevisionId = z.infer<typeof OutlineRevisionId>
export type LessonRevisionId = z.infer<typeof LessonRevisionId>
export type PublicationRevisionId = z.infer<typeof PublicationRevisionId>
export type PrivacyReviewId = z.infer<typeof PrivacyReviewId>
export type GrantId = z.infer<typeof GrantId>
export type InstallationId = z.infer<typeof InstallationId>
export type OwnerId = z.infer<typeof OwnerId>
export type SceneId = z.infer<typeof SceneId>
export type ContentId = z.infer<typeof ContentId>
export type RunId = z.infer<typeof RunId>
export type AttemptId = z.infer<typeof AttemptId>
export type JobId = z.infer<typeof JobId>
export type ArtifactId = z.infer<typeof ArtifactId>
export type InputRevisionId = z.infer<typeof InputRevisionId>
export const Timestamp = z.iso.datetime()
export const Natural = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const ResourcePath = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (path) =>
      !/[\\:%?#]/u.test(path) &&
      [...path].every((character) => character.charCodeAt(0) >= 32) &&
      path.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."),
  )
  .brand<"ResourcePath">()

export function uniqueValues<T extends z.ZodType>(schema: T) {
  return z
    .array(schema)
    .refine((items) => new Set(items).size === items.length, "duplicate values")
    .readonly()
}

export function uniqueItems<T extends z.ZodType<{ readonly id: string }>>(schema: T) {
  return z
    .array(schema)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "duplicate IDs")
    .readonly()
}

export function assertNever(value: never): never {
  throw new TypeError(`Unexpected variant: ${String(value)}`)
}
