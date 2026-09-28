import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  contentDigest,
  EvidenceView,
  PublicationProjection,
  projectedStrings,
  requiredTeachingStates,
} from "@reading-studio/contracts"
import { generateFixtureLesson } from "@reading-studio/generation/lesson"
import * as review from "@reading-studio/generation/review"
import { openStorage, type Storage } from "@reading-studio/storage"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { lessonFixture } from "./lesson-fixture.ts"

describe("evidence and privacy gate", () => {
  let storage: Storage
  let root: string
  let lessonId: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "evidence-"))
    storage = openStorage({ databasePath: join(root, "db.sqlite"), privateDataRoot: root })
    const fixture = lessonFixture(storage)
    storage.outlines.decide({
      studyId: "study-1",
      revisionId: fixture.outline.id,
      action: "approve",
    })
    lessonId = generateFixtureLesson(storage, fixture.request, fixture.draft).lesson.id
  })
  afterEach(() => {
    storage.close()
    rmSync(root, { recursive: true, force: true })
  })

  it("starts unresolved rather than claiming semantic truth when mechanical checks pass", () => {
    // Given / When
    const view = review.openEvidenceReview(storage, lessonId)
    // Then
    expect(view.mechanical).toEqual([])
    expect(view.ready).toBe(false)
    expect(view.draft.semantic.map((item) => item.status)).toEqual(Array(4).fill("unresolved"))
    expect(Object.keys(view.draft.projection).sort()).toEqual([
      "assets",
      "bookMap",
      "sections",
      "title",
    ])
    expect(JSON.stringify(view.draft.projection)).not.toContain('"reviewerFlags"')
  })

  it("blocks a fabricated quotation even when all semantic uncertainty is acknowledged", () => {
    // Given
    const initial = review.openEvidenceReview(storage, lessonId)
    const projection = {
      ...initial.draft.projection,
      sections: initial.draft.projection.sections.map((section) => ({
        ...section,
        sourceNotes: section.sourceNotes.map((note) => ({
          ...note,
          quotation: "Invented quotation",
        })),
      })),
    }
    const edited = review.changeEvidenceReview(storage, lessonId, {
      action: "correct",
      expectedId: initial.draft.id,
      projection,
    })
    // When
    const acknowledged = review.changeEvidenceReview(storage, lessonId, {
      action: "semantic",
      expectedId: edited.draft.id,
      category: "support",
      status: "acknowledged",
    })
    // Then
    expect(acknowledged.mechanical.some((flag) => flag.category === "unsupported-quotation")).toBe(
      true,
    )
    expect(acknowledged.ready).toBe(false)
  })

  it("invalidates every review when one caption changes and rejects a stale tab", () => {
    // Given
    let view = review.openEvidenceReview(storage, lessonId)
    view = review.changeEvidenceReview(storage, lessonId, {
      action: "correct",
      expectedId: view.draft.id,
      projection: {
        ...view.draft.projection,
        sections: view.draft.projection.sections.map((section) => ({
          ...section,
          scenes: section.scenes.map((scene) => ({
            ...scene,
            captions: requiredTeachingStates(scene).map((state) => ({
              stateId: state.id,
              text: state.explanation,
            })),
          })),
        })),
      },
    })
    for (const category of ["support", "qualification", "translation", "visual"] as const)
      view = review.changeEvidenceReview(storage, lessonId, {
        action: "semantic",
        expectedId: view.draft.id,
        category,
        status: "acknowledged",
      })
    view = review.changeEvidenceReview(storage, lessonId, {
      action: "privacy-reviewed",
      expectedId: view.draft.id,
    })
    expect(view.ready).toBe(true)
    const before = view
    // When
    const changed = review.changeEvidenceReview(storage, lessonId, {
      action: "replace-text",
      expectedId: before.draft.id,
      path: "/sections/0/scenes/0/captions/0/text/en",
      text: "Changed caption",
    })
    // Then
    expect(changed.draft.projectionHash).not.toBe(before.draft.projectionHash)
    expect(changed.ready).toBe(false)
    expect(changed.privacy.status).toBe("blocked")
    expect(() =>
      review.changeEvidenceReview(storage, lessonId, {
        action: "privacy-reviewed",
        expectedId: before.draft.id,
      }),
    ).toThrow()
    storage.close()
    storage = openStorage({ databasePath: join(root, "db.sqlite"), privateDataRoot: root })
    expect(review.openEvidenceReview(storage, lessonId).draft.id).toBe(changed.draft.id)
  })

  it("retains a manual privacy flag through unrelated edits and semantic acknowledgements", () => {
    // Given
    let view = review.openEvidenceReview(storage, lessonId)
    view = review.changeEvidenceReview(storage, lessonId, {
      action: "privacy-flag",
      expectedId: view.draft.id,
      path: "/title/en",
    })
    // When
    view = review.changeEvidenceReview(storage, lessonId, {
      action: "semantic",
      expectedId: view.draft.id,
      category: "support",
      status: "acknowledged",
    })
    // Then
    expect(view.privacy.findings.map((finding) => finding.path)).toContain("/title/en")
    expect(() =>
      review.changeEvidenceReview(storage, lessonId, {
        action: "privacy-reviewed",
        expectedId: view.draft.id,
      }),
    ).toThrow()
  })

  it.each([
    ["English name", "Mira Canarystone", "Mira Canarystone"],
    ["Japanese name", "山田花子", "山 田\u200b花 子"],
    ["full width", "Mira", "Ｍｉｒａ"],
    ["serialized escape", "山田花子", String.raw`{"person":"\u5c71\u7530\u82b1\u5b50"}`],
  ])("catches %s across every projected string", (_, canary, payload) => {
    // Given
    const initial = review.openEvidenceReview(storage, lessonId)
    const projection = PublicationProjection.parse({
      ...initial.draft.projection,
      assets: [
        {
          id: "asset-1",
          contentHash: "a".repeat(64),
          mediaType: "image/png",
          alt: { en: "Diagram", ja: "図" },
          license: "CC0",
        },
      ],
    })
    const fields = projectedStrings(projection).filter((entry) =>
      /\/(en|ja|quotation|license)$/u.test(entry.path),
    )
    let current = review.changeEvidenceReview(storage, lessonId, {
      action: "private-detail",
      expectedId: initial.draft.id,
      text: canary,
    })
    // When / Then
    for (const field of fields) {
      current = review.changeEvidenceReview(storage, lessonId, {
        action: "correct",
        expectedId: current.draft.id,
        projection,
      })
      current = review.changeEvidenceReview(storage, lessonId, {
        action: "replace-text",
        expectedId: current.draft.id,
        path: field.path,
        text: payload,
      })
      const report = current.privacy
      expect(report.status, field.path).toBe("blocked")
      expect(
        report.findings.map((finding) => finding.path),
        field.path,
      ).toContain(field.path)
      expect(report.reviewedPaths).toEqual(
        projectedStrings(current.draft.projection).map((entry) => entry.path),
      )
    }
  })

  it("rejects a fabricated locator and does not let Keep private become publishable", () => {
    // Given
    const initial = review.openEvidenceReview(storage, lessonId)
    const changed = review.changeEvidenceReview(storage, lessonId, {
      action: "replace-text",
      expectedId: initial.draft.id,
      path: "/sections/0/sourceNotes/0/locator",
      text: "invented.xhtml#unknown:0-10",
    })
    // When
    const kept = review.changeEvidenceReview(storage, lessonId, {
      action: "keep-private",
      expectedId: changed.draft.id,
    })
    // Then
    expect(kept.mechanical.some((flag) => flag.category === "broken-locator")).toBe(true)
    expect(kept.ready).toBe(false)
    expect(kept.draft.keepPrivate).toBe(true)
  })

  it("cannot transplant a privacy report onto another projection", () => {
    // Given
    const initial = review.openEvidenceReview(storage, lessonId)
    // When
    const forged = {
      ...initial,
      privacy: { ...initial.privacy, projectionHash: contentDigest("other") },
    }
    // Then
    expect(EvidenceView.safeParse(forged).success).toBe(false)
  })

  it("blocks an old lesson after its outline changes", () => {
    // Given
    const initial = review.openEvidenceReview(storage, lessonId)
    const outline = storage.outlines.current(initial.draft.studyId)
    if (!outline) throw new TypeError("Missing fixture outline")
    storage.outlines.decide({
      studyId: initial.draft.studyId,
      revisionId: outline.draft.id,
      action: "revise",
    })
    // When / Then
    expect(() => review.openEvidenceReview(storage, lessonId)).toThrow()
  })
})
