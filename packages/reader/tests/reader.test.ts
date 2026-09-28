import { publicationTeachingStateIds, requiredTeachingStates } from "@reading-studio/contracts"
import { Window } from "happy-dom"
import { describe, expect, it } from "vitest"
import { readerDocument, spatialRuntime } from "../src/index.ts"
import { lessons } from "./fixtures.ts"

describe("editorial reader", () => {
  for (const lesson of lessons) {
    it("includes every canonical state and practice prompt when rendered statically", async () => {
      // Given
      const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
      // When
      window.document.write(String(await readerDocument(lesson)))
      // Then
      const document = window.document
      expect(
        [...document.querySelectorAll("[data-state]")]
          .map((node) => node.getAttribute("data-state"))
          .sort(),
      ).toEqual([...publicationTeachingStateIds(lesson)].sort())
      for (const section of lesson.sections) {
        for (const scene of section.scenes) {
          for (const state of requiredTeachingStates(scene)) {
            const element = document.getElementById(`state-${state.id}`)
            expect(element?.textContent).toContain(state.explanation.en)
            expect(element?.textContent).toContain(state.explanation.ja)
          }
        }
        for (const exercise of [
          ...section.practice,
          ...section.scenes.flatMap((scene) => scene.practice),
        ]) {
          expect(document.body.textContent).toContain(exercise.prompt.en)
          expect(document.body.textContent).toContain(exercise.prompt.ja)
        }
      }
      const ids = [...document.querySelectorAll("[id]")].map((node) => node.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const link of document.querySelectorAll('a[href^="#"]'))
        expect(document.getElementById(link.getAttribute("href")?.slice(1) ?? "")).not.toBeNull()
      await window.happyDOM.close()
    })
  }
  it("renders hostile strings as text when supplied in source content", async () => {
    // Given
    const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
    // When
    window.document.write(String(await readerDocument(lessons[1])))
    // Then
    expect(
      window.document.querySelectorAll(
        "script:not([data-scene-runtime]):not([data-three-runtime]),img,iframe,[onerror],[onload]",
      ),
    ).toHaveLength(0)
    expect(window.document.querySelector("script[data-three-runtime]")?.textContent).toBe(
      spatialRuntime,
    )
    expect(window.document.body.textContent).toContain('<script>alert("reader")</script>')
    expect(window.document.querySelector('a[href^="javascript:"]')).toBeNull()
    await window.happyDOM.close()
  })
  it("rejects missing locale content when input crosses the reader boundary", () => {
    // Given
    const invalid = { ...lessons[0], title: { en: "Only English" } }
    // When / Then
    expect(() => readerDocument(invalid)).toThrow()
  })
  it("keeps captions and asset descriptions readable when a lesson supplies them", async () => {
    // Given
    const lesson = lessons[0]
    const input = {
      ...lesson,
      sections: lesson.sections.map((section) => ({
        ...section,
        scenes: section.scenes.map((scene) => ({
          ...scene,
          captions: requiredTeachingStates(scene).map((state) => ({
            stateId: state.id,
            text: state.explanation,
          })),
        })),
      })),
      assets: [
        {
          id: "asset",
          contentHash: "a".repeat(64),
          mediaType: "image/png",
          alt: { en: "An illustrative map", ja: "説明のための地図" },
          license: "CC0",
        },
      ],
    }
    const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
    // When
    window.document.write(String(await readerDocument(input)))
    // Then
    expect(window.document.querySelectorAll(".caption")).toHaveLength(6)
    expect(window.document.body.textContent).toContain(input.assets[0]?.alt.ja)
    expect(window.document.querySelectorAll("img")).toHaveLength(0)
    await window.happyDOM.close()
  })
  it("rejects blank Japanese content rather than rendering an empty panel", () => {
    // Given
    const invalid = { ...lessons[0], title: { en: "English", ja: "  " } }
    // When / Then
    expect(() => readerDocument(invalid)).toThrow()
  })
})
