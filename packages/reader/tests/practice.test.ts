import { Practice, PublicationProjection } from "@reading-studio/contracts"
import { Window } from "happy-dom"
import { describe, expect, it } from "vitest"
import { readerDocument } from "../src/index.ts"
import { lessons } from "./fixtures.ts"

describe("learner practice", () => {
  it("offers actual choices when rendering existing exercises", async () => {
    // Given
    const window = new Window()
    // When
    window.document.write(String(await readerDocument(lessons[0])))
    // Then
    expect(window.document.querySelectorAll('.practice input[type="radio"]')).toHaveLength(6)
    await window.happyDOM.close()
  })

  it("accepts chapter navigation and rejects a missing target when parsing a projection", () => {
    // Given
    const bookMap = [
      { id: "chapter-1", title: { en: "Attention", ja: "注意" }, sectionIds: ["attention"] },
    ]
    // When / Then
    expect(PublicationProjection.safeParse({ ...lessons[0], bookMap }).success).toBe(true)
    expect(
      PublicationProjection.safeParse({
        ...lessons[0],
        bookMap: [{ ...bookMap[0], sectionIds: ["missing"] }],
      }).success,
    ).toBe(false)
  })

  it("blocks an exercise without feedback at the publication boundary", () => {
    // Given
    const section = lessons[0].sections[0]
    const input = {
      ...lessons[0],
      sections: [
        {
          ...section,
          practice: [
            {
              id: "broken",
              prompt: { en: "Choose", ja: "選択" },
              options: [{ id: "one", label: { en: "One", ja: "一" } }],
            },
          ],
        },
      ],
    }
    // When / Then
    expect(PublicationProjection.safeParse(input).success).toBe(false)
  })

  it("rejects choice-free questions and preference or score fields at the practice boundary", () => {
    const exercise = {
      id: "reflection",
      kind: "reflection",
      prompt: { en: "Choose a next step", ja: "次の一歩を選ぶ" },
      options: [
        {
          id: "skip",
          label: { en: "Skip", ja: "見送る" },
          feedback: { en: "No assessment", ja: "評価なし" },
        },
      ],
    }
    expect(Practice.safeParse(exercise).success).toBe(true)
    expect(Practice.safeParse({ ...exercise, options: [] }).success).toBe(false)
    expect(Practice.safeParse({ ...exercise, kind: "preference" }).success).toBe(false)
    expect(Practice.safeParse({ ...exercise, score: 100 }).success).toBe(false)
    expect(
      Practice.safeParse({
        ...exercise,
        options: [{ ...exercise.options[0], feedback: { en: "", ja: "評価なし" } }],
      }).success,
    ).toBe(false)
  })
})
