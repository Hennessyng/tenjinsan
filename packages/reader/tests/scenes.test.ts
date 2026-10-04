import { requiredTeachingStates } from "@reading-studio/contracts"
import { Window } from "happy-dom"
import { expect, it } from "vitest"
import { readerDocument } from "../src/index.ts"
import { lessons } from "./fixtures.ts"
import { sceneLesson } from "./scene-fixture.ts"

it("declares exactly the trusted print states for every scene, including static-only kinds", async () => {
  // Given
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
  // When
  window.document.write(String(await readerDocument(lessons[1])))
  // Then
  for (const scene of lessons[1].sections.flatMap((section) => section.scenes)) {
    const node = window.document.getElementById(`scene-${scene.id}`)?.closest("section")
    expect(JSON.parse(node?.getAttribute("data-print-states") ?? "null")).toEqual(
      requiredTeachingStates(scene).map((state) => state.id),
    )
  }
  await window.happyDOM.close()
})

it("overlaps successive layers and keeps comparisons inside the diagram gutters", async () => {
  // Given
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
  // When
  window.document.write(String(await readerDocument(sceneLesson)))
  // Then
  expect(window.document.querySelectorAll("figcaption [data-loop-caption] [lang]")).toHaveLength(2)
  const layers = Array.from(
    window.document.querySelectorAll('[data-svg-scene="layered-diagram"] rect'),
  )
  for (let index = 1; index < layers.length; index++) {
    const previous = layers[index - 1]
    const current = layers[index]
    expect(
      Number(previous?.getAttribute("y")) + Number(previous?.getAttribute("height")),
    ).toBeGreaterThan(Number(current?.getAttribute("y")))
  }
  for (const rect of window.document.querySelectorAll('[data-svg-scene="comparison"] rect')) {
    expect(Number(rect.getAttribute("x"))).toBeGreaterThanOrEqual(32)
    expect(Number(rect.getAttribute("x")) + Number(rect.getAttribute("width"))).toBeLessThanOrEqual(
      288,
    )
  }
  await window.happyDOM.close()
})

it("renders semantic SVG figures and initially hidden native controls for supported scenes", async () => {
  // Given
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
  // When
  window.document.write(String(await readerDocument(lessons[0])))
  // Then
  expect(window.document.querySelectorAll("figure svg[role=img]")).toHaveLength(2)
  expect(window.document.querySelectorAll("figure figcaption")).toHaveLength(2)
  expect(window.document.querySelectorAll("[data-scene-controls][hidden]")).toHaveLength(2)
  expect(window.document.querySelectorAll("script[data-scene-runtime]")).toHaveLength(1)
  await window.happyDOM.close()
})
