import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import { exportPdf } from "../pdf/index.ts"
import { approved } from "./fixture.ts"
import { printRevision } from "./print-fixture.ts"

describe("PDF boundary", () => {
  it.each([0, -1, 60_001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid time budget %s",
    async (timeoutMs) => {
      await expect(exportPdf(printRevision, { timeoutMs })).rejects.toMatchObject({
        reason: "limit",
      })
    },
  )
  it("rejects stale approval when a private caption is introduced", async () => {
    // Given
    const revision = structuredClone(printRevision)
    const scene = revision.projection.sections[0]?.scenes[0]
    if (!scene) throw new Error("fixture scene missing")
    const changedScene = {
      ...scene,
      captions: [
        {
          stateId: "layers:layer:first",
          text: {
            en: "PRIVATE_CAPTION_CANARY",
            ja: "秘密の個人情報",
          },
        },
      ],
    }
    // When / Then
    await expect(
      exportPdf({
        ...revision,
        projection: {
          ...revision.projection,
          sections: revision.projection.sections.map((section) => ({
            ...section,
            scenes: section.scenes.map((item) => (item.id === scene.id ? changedScene : item)),
          })),
        },
      }),
    ).rejects.toBeInstanceOf(ZodError)
  })

  it("rejects stale approval when private feedback is introduced", async () => {
    // Given
    const revision = structuredClone(printRevision)
    const option = revision.projection.sections[0]?.practice[0]?.options[0]
    if (!option) throw new Error("fixture option missing")
    const changedOption = {
      ...option,
      feedback: { ...option.feedback, en: "PRIVATE_FEEDBACK_CANARY" },
    }
    // When / Then
    await expect(
      exportPdf({
        ...revision,
        projection: {
          ...revision.projection,
          sections: revision.projection.sections.map((section) => ({
            ...section,
            practice: section.practice.map((exercise) => ({
              ...exercise,
              options: exercise.options.map((item) =>
                item.id === option.id ? changedOption : item,
              ),
            })),
          })),
        },
      }),
    ).rejects.toBeInstanceOf(ZodError)
  })

  it("fails the deadline when an approved asset resolver never settles", async () => {
    // Given
    const revision = approved({
      ...printRevision.projection,
      assets: [
        {
          id: "waiting",
          contentHash: "a".repeat(64),
          mediaType: "font/woff2",
          alt: { en: "Font", ja: "書体" },
          license: "OFL-1.1",
        },
      ],
    })
    // When / Then
    await expect(
      exportPdf(revision, {
        timeoutMs: 50,
        resolveAsset: () => new Promise<Uint8Array>(() => {}),
      }),
    ).rejects.toMatchObject({ reason: "timeout" })
  })
})
