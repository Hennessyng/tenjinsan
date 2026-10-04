import { z } from "zod"
import { assertNever, Bilingual, ContentId, OptionId, SceneId, uniqueItems } from "./primitives.ts"

export const PracticeOption = z
  .strictObject({ id: OptionId, label: Bilingual, feedback: Bilingual })
  .readonly()
export const Practice = z
  .strictObject({
    id: ContentId,
    prompt: Bilingual,
    kind: z.enum(["reply", "topic", "reflection"]).optional(),
    scenario: Bilingual.optional(),
    attribution: Bilingual.optional(),
    options: uniqueItems(PracticeOption).refine((options) => options.length > 0),
  })
  .readonly()
export type Practice = z.infer<typeof Practice>
const TeachingItem = z
  .strictObject({ id: ContentId, label: Bilingual, explanation: Bilingual })
  .readonly()
const items = uniqueItems(TeachingItem).refine((values) => values.length > 0)
export const TeachingStateId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+){2,3}$/)
  .brand<"TeachingStateId">()
export const TeachingState = z
  .strictObject({ id: TeachingStateId, label: Bilingual, explanation: Bilingual })
  .readonly()
export type TeachingState = z.infer<typeof TeachingState>
const base = {
  id: SceneId,
  title: Bilingual,
  practice: uniqueItems(Practice),
  captions: z
    .array(z.strictObject({ stateId: TeachingStateId, text: Bilingual }).readonly())
    .readonly()
    .optional(),
}
const SceneContent = z
  .discriminatedUnion("kind", [
    z.strictObject({ ...base, kind: z.literal("layered-diagram"), layers: items }),
    z.strictObject({ ...base, kind: z.literal("comparison"), variants: items }),
    z.strictObject({ ...base, kind: z.literal("timeline"), events: items }),
    z.strictObject({
      ...base,
      kind: z.literal("annotated-process"),
      steps: items,
      loop: z.boolean(),
    }),
    z.strictObject({ ...base, kind: z.literal("perspective-3d"), viewpoints: items }),
    z.strictObject({
      ...base,
      kind: z.literal("spatial-layers-3d"),
      layers: items,
      viewpoints: items,
    }),
  ])
  .readonly()
type SceneContent = z.infer<typeof SceneContent>

export function practiceTeachingStates(
  practice: readonly Practice[],
  prefix: string,
): readonly TeachingState[] {
  return Object.freeze(
    practice.flatMap((exercise) =>
      exercise.options.map((option) =>
        Object.freeze({
          id: TeachingStateId.parse(`${prefix}:practice:${exercise.id}:${option.id}`),
          label: option.label,
          explanation: option.feedback,
        }),
      ),
    ),
  )
}

export function requiredTeachingStates(scene: SceneContent): readonly TeachingState[] {
  const states = (values: readonly z.infer<typeof TeachingItem>[], category: string) =>
    values.map((item) =>
      Object.freeze({
        id: TeachingStateId.parse(`${scene.id}:${category}:${item.id}`),
        label: item.label,
        explanation: item.explanation,
      }),
    )
  let content: readonly TeachingState[]
  switch (scene.kind) {
    case "layered-diagram":
      content = states(scene.layers, "layer")
      break
    case "comparison":
      content = states(scene.variants, "variant")
      break
    case "timeline":
      content = states(scene.events, "event")
      break
    case "annotated-process":
      content = states(scene.steps, "step")
      break
    case "perspective-3d":
      content = states(scene.viewpoints, "viewpoint")
      break
    case "spatial-layers-3d":
      content = [...states(scene.layers, "layer"), ...states(scene.viewpoints, "viewpoint")]
      break
    default:
      return assertNever(scene)
  }
  return Object.freeze([...content, ...practiceTeachingStates(scene.practice, scene.id)])
}
export const SceneSpec = SceneContent.superRefine((scene, ctx) => {
  if (scene.captions !== undefined) {
    const required = requiredTeachingStates(scene).map((state) => state.id)
    const supplied = scene.captions.map((caption) => caption.stateId)
    if (
      new Set(supplied).size !== supplied.length ||
      supplied.length !== required.length ||
      !required.every((id) => supplied.includes(id))
    )
      ctx.addIssue({ code: "custom", message: "captions must cover exactly every canonical state" })
  }
})
export type SceneSpec = z.infer<typeof SceneSpec>
