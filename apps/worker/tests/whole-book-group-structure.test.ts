import { rmSync } from "node:fs"
import { NormalizationRevision, StudySetupRevision } from "@reading-studio/contracts"
import { prepareBookMapScope } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { bookMapFixture } from "./book-map-fixture.ts"

const fixtures: ReturnType<typeof bookMapFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.storage.close()
    rmSync(fixture.directory, { recursive: true, force: true })
  }
})

it("preserves heading hierarchy across resources and identifies unheaded structure", () => {
  // Given
  const fixture = bookMapFixture("Front matter", 4)
  fixtures.push(fixture)
  const original = fixture.storage.sources.getSetup("setup-1")
  const stored = fixture.storage.sources.getNormalization("normalization-1")
  if (!original || !stored) throw new TypeError("Missing synthetic fixture")
  const setup = StudySetupRevision.parse({
    ...original,
    analysis: {
      ...original.analysis,
      scope: { ...original.analysis.scope, kind: "whole-document" },
      analysisPromptVersion: "whole-book-2",
      analysisSchemaVersion: "whole-book-2",
    },
  })
  const normalization = NormalizationRevision.parse({
    ...stored,
    resources: stored.resources.map((resource, index) =>
      resource.status === "included" && index === 0
        ? {
            ...resource,
            blocks: resource.blocks.map((block, i) => ({
              ...block,
              text: ["Front matter", "Chapter", "Section", "Body"][i] ?? "Body",
              ...(i === 1 ? { heading: 1 } : i === 2 ? { heading: 2 } : {}),
            })),
          }
        : { ...resource, role: "supplementary" },
    ),
  })
  // When
  const result = prepareBookMapScope(setup, normalization)
  // Then
  expect(result.kind).toBe("ready")
  const plan = z
    .object({
      groups: z.array(
        z.object({
          id: z.string(),
          provenance: z.enum(["heading", "structural"]),
          parentId: z.string().nullable(),
          ranges: z.array(z.object({ resourcePath: z.string() })),
        }),
      ),
    })
    .parse(result)
  expect(plan.groups.map((group) => group.provenance)).toEqual(["structural", "heading", "heading"])
  expect(plan.groups[2]?.parentId).toBe(plan.groups[1]?.id)
  expect(plan.groups[2]?.ranges.map((range) => range.resourcePath)).toContain("text/company.xhtml")
  expect(plan.groups.flatMap((group) => group.ranges)).toHaveLength(5)
  expect(fixture.storage.counts()).toMatchObject({ jobs: 0, attempts: 0 })
})
