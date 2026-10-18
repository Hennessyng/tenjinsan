import { rmSync } from "node:fs"
import { afterEach, expect, it } from "vitest"
import { bookMapFixture, FixtureAdapter, fixtureWorker } from "./book-map-fixture.ts"

const fixtures: ReturnType<typeof bookMapFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

it.each(["same-chapter", "anchor-only-chapter"] as const)(
  "keeps an all-main map partial when an empty selected anchor has no analysis window: %s",
  async (placement) => {
    // Given
    const fixture = bookMapFixture()
    fixtures.push(fixture)
    const sources = fixture.storage.sources
    const normalization = sources.getNormalization("normalization-1")
    const setup = sources.getSetup("setup-1")
    const grant = sources.getGrant("grant-1")
    if (!normalization || !setup || !grant) throw new TypeError("Missing fixture")
    const anchor = {
      id: "empty-anchor",
      text: "",
      originalFragment: "retained-drawing-anchor",
      locator: { kind: "docx", part: "word/document.xml", paragraph: 2 },
    } as const
    const resources = normalization.resources.map((resource, index) =>
      resource.status === "included" && index === (placement === "same-chapter" ? 0 : 1)
        ? {
            ...resource,
            blocks: placement === "same-chapter" ? [...resource.blocks, anchor] : [anchor],
          }
        : resource,
    )
    sources.appendNormalization({
      record: { ...normalization, id: "normalization-anchor", resources },
      parentRevisionId: normalization.id,
    })
    sources.appendSetup({
      record: {
        ...setup,
        id: "setup-anchor",
        analysis: {
          ...setup.analysis,
          normalizationRevisionId: "normalization-anchor",
          scope: {
            kind: "all-main-chapters",
            selected: resources.flatMap((resource) =>
              resource.status === "included"
                ? [
                    {
                      resourcePath: resource.path,
                      blockIds: resource.blocks.map((block) => block.id),
                    },
                  ]
                : [],
            ),
            exclusions: [],
          },
        },
      },
      parentRevisionId: setup.id,
    })
    sources.appendGrant({ ...grant, id: "grant-anchor", setupRevisionId: "setup-anchor" })
    const adapter = new FixtureAdapter()
    const { pipeline, worker } = fixtureWorker(fixture.storage, adapter)
    pipeline.prepare("setup-anchor", "grant-anchor")
    // When
    while ((await worker.runNext()).kind !== "idle") {}
    const map = pipeline.prepare("setup-anchor", "grant-anchor")
    // Then
    expect(map.status).toBe("partial")
    const chapter = map.chapters.find((chapter) =>
      chapter.blockIds.some((id) => id === "empty-anchor"),
    )
    expect(chapter).toMatchObject({ status: "uncovered", uncoveredBlockIds: ["empty-anchor"] })
    expect(adapter.requests).toHaveLength(placement === "same-chapter" ? 2 : 1)
    expect(sources.getNormalization("normalization-anchor")?.resources).toEqual(resources)
    expect(fixture.storage.workflow.findSuccessfulAnalysis(map.cacheKey)).toBeNull()
    const legacy = fixture.storage.workflow.appendAnalysis({
      record: {
        ...map,
        id: "legacy-vacuous-success",
        status: "successful",
        chapters: map.chapters.map((chapter) => ({
          resourcePath: chapter.resourcePath,
          blockIds: chapter.blockIds,
          status: "complete",
        })),
      },
      parentRevisionId: null,
    })
    expect(pipeline.prepare("setup-anchor", "grant-anchor").status).toBe("partial")
    expect(fixture.storage.workflow.getAnalysis(legacy.id)).toEqual(legacy)
  },
)
