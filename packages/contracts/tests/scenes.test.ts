import { describe, expect, it } from "vitest"
import { requiredTeachingStates, SceneSpec } from "../src/index.ts"

const label = { en: "A visible explanation", ja: "説明" }
const items = [
  { id: "first", label, explanation: label },
  { id: "second", label, explanation: label },
]
const practice = [
  {
    id: "practice-1",
    prompt: label,
    options: [
      { id: "choice-1", label, feedback: label },
      { id: "choice-2", label, feedback: label },
    ],
  },
]
export const scenes = [
  { kind: "layered-diagram", layers: items },
  { kind: "comparison", variants: items },
  { kind: "timeline", events: items },
  { kind: "annotated-process", steps: items, loop: true },
  { kind: "perspective-3d", viewpoints: items },
  {
    kind: "spatial-layers-3d",
    layers: items,
    viewpoints: [{ id: "overview", label, explanation: label }],
  },
].map((variant) => ({ id: "scene-1", title: label, practice, ...variant }))
const expected = [
  ["scene-1:layer:first", "scene-1:layer:second"],
  ["scene-1:variant:first", "scene-1:variant:second"],
  ["scene-1:event:first", "scene-1:event:second"],
  ["scene-1:step:first", "scene-1:step:second"],
  ["scene-1:viewpoint:first", "scene-1:viewpoint:second"],
  ["scene-1:layer:first", "scene-1:layer:second", "scene-1:viewpoint:overview"],
]
describe("trusted scene registry", () => {
  it.each(scenes.map((scene, index) => ({ scene, states: expected[index] })))(
    "derives complete states when variant is $scene.kind",
    ({ scene, states }) => {
      const result = requiredTeachingStates(SceneSpec.parse(scene))
      expect(result.map((state) => state.id)).toEqual([
        ...(states ?? []),
        "scene-1:practice:practice-1:choice-1",
        "scene-1:practice:practice-1:choice-2",
      ])
      expect(result.every((state) => state.explanation.en.length > 0)).toBe(true)
    },
  )
  it.each(["html", "javascript", "shader", "requiredStates", "requiredTeachingStates"])(
    "rejects generated field %s",
    (field) => {
      const result = SceneSpec.safeParse({ ...scenes[0], [field]: [] })
      expect(result.success).toBe(false)
    },
  )
  it("rejects missing canonical captions when captions are supplied", () => {
    const result = SceneSpec.safeParse({
      ...scenes[0],
      captions: [{ stateId: "scene-1:layer:first", text: label }],
    })
    expect(result.success).toBe(false)
  })
  it("rejects duplicate content identifiers", () => {
    const result = SceneSpec.safeParse({ ...scenes[0], layers: [items[0], items[0]] })
    expect(result.success).toBe(false)
  })
})
