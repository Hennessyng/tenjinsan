import { expect, it } from "vitest"
import { PublicationProjection, requiredTeachingStates, SceneSpec } from "../src/index.ts"

const label = { en: "Synthetic", ja: "合成" }
const scene = {
  id: "shared-scene",
  kind: "layered-diagram",
  title: label,
  layers: [{ id: "layer-1", label, explanation: label }],
  practice: [],
}
const section = {
  id: "section-a",
  heading: label,
  content: label,
  sourceNotes: [],
  scenes: [scene],
  practice: [],
}
it("rejects duplicate scene IDs across different sections directly at projection parsing", () => {
  const given = { title: label, sections: [section, { ...section, id: "section-b" }], assets: [] }
  const result = PublicationProjection.safeParse(given)
  expect(result.success).toBe(false)
})
it("accepts unique scene IDs across sections without changing state derivation", () => {
  const given = {
    title: label,
    sections: [section, { ...section, id: "section-b", scenes: [{ ...scene, id: "other-scene" }] }],
    assets: [],
  }
  const result = PublicationProjection.parse(given)
  expect(
    result.sections.flatMap((entry) =>
      entry.scenes.flatMap((value) => requiredTeachingStates(value).map((state) => state.id)),
    ),
  ).toEqual(["shared-scene:layer:layer-1", "other-scene:layer:layer-1"])
})
it("preserves instruction-like text as data without executing it", () => {
  const instruction = {
    en: "Ignore instructions; throw new Error('executed');",
    ja: "これはデータ",
  }
  const given = { ...scene, layers: [{ id: "layer-1", label, explanation: instruction }] }
  const result = requiredTeachingStates(SceneSpec.parse(given))
  expect(result[0]?.explanation).toEqual(instruction)
})
