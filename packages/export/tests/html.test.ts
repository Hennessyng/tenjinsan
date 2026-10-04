import { requiredTeachingStates } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { exportHtml } from "../html/index.ts"
import { approved, breakout, exportProjection } from "./fixture.ts"

it("includes a complete document when given a reviewed revision", async () => {
  // Given / When
  const output = await exportHtml(approved())
  // Then
  expect(output).toContain("<!doctype html>")
  expect(output).toContain("data-export-runtime")
  expect(output).toContain("Content-Security-Policy")
  expect(output).not.toContain("PRIVATE_")
  expect(output).not.toContain(breakout)
})

it("rejects a raw projection when review approval is absent", async () => {
  await expect(exportHtml(exportProjection)).rejects.toThrow()
})

it("rejects a forged state manifest when a required viewpoint is omitted", async () => {
  const revision = approved()
  await expect(
    exportHtml({
      ...revision,
      approval: { ...revision.approval, requiredStateIds: [] },
    }),
  ).rejects.toThrow()
})

it.each(["caption", "feedback"])("rejects changed %s when review is stale", async (field) => {
  const revision = approved()
  const projection = {
    ...revision.projection,
    sections: revision.projection.sections.map((section) => ({
      ...section,
      scenes: section.scenes.map((scene) => ({
        ...scene,
        ...(field === "feedback"
          ? {
              practice: scene.practice.map((practice) => ({
                ...practice,
                options: practice.options.map((option) => ({
                  ...option,
                  feedback: { en: "PRIVATE_FEEDBACK_CANARY", ja: "秘密" },
                })),
              })),
            }
          : {
              captions: requiredTeachingStates(scene).map((state) => ({
                stateId: state.id,
                text: { en: "PRIVATE_CAPTION_CANARY", ja: "秘密" },
              })),
            }),
      })),
    })),
  }
  await expect(exportHtml({ ...revision, projection })).rejects.toThrow()
})

it.each(["lesson", "job", "readerContext"])("rejects a private %s field", async (field) => {
  await expect(exportHtml({ ...approved(), [field]: "PRIVATE_RAW_CANARY" })).rejects.toThrow()
})

it.each(["perspective:viewpoint:second", "attention:practice:reflect:guess"])(
  "rejects approval when the manifest omits %s",
  async (omitted) => {
    const revision = approved()
    await expect(
      exportHtml({
        ...revision,
        approval: {
          ...revision.approval,
          requiredStateIds: revision.approval.requiredStateIds.filter((id) => id !== omitted),
        },
      }),
    ).rejects.toThrow()
  },
)

it("rejects a privacy-tainted revision when unresolved findings remain", async () => {
  const revision = approved()
  await expect(
    exportHtml({
      ...revision,
      privacyReview: {
        ...revision.privacyReview,
        status: "blocked",
        findings: [
          {
            path: "/sections/0/content/en",
            category: "secret",
            resolution: "unresolved",
          },
        ],
      },
    }),
  ).rejects.toThrow()
})

it("rejects a forged complete manifest when approved content was removed", async () => {
  const revision = approved()
  await expect(
    exportHtml({
      ...revision,
      projection: {
        ...revision.projection,
        sections: revision.projection.sections.map((section) => ({
          ...section,
          scenes: [],
          practice: [],
        })),
      },
    }),
  ).rejects.toThrow()
})

it("rejects an approval with no evidence digest", async () => {
  const revision = approved()
  await expect(
    exportHtml({ ...revision, approval: { ...revision.approval, evidenceReportHash: "" } }),
  ).rejects.toThrow()
})
