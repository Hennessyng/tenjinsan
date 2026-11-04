import {
  BATCHED_VERIFICATION_VERSION,
  BookSynthesis,
  ChapterPartMap,
  ContentId,
  SourceSpan,
  StudySetupRevision,
  WindowOriginal,
} from "@reading-studio/contracts"
import { reviewedSourceBlocks } from "@reading-studio/providers"
import { fixtureCapacity, wholeBookFixture } from "./whole-book-fixture.ts"

export async function batchingFixture(
  text = `Opening. ${"original material ".repeat(20)}Late exception.`,
) {
  const fixture = await wholeBookFixture(text, 1)
  const old = fixture.storage.sources.getSetup("setup-whole"),
    normalization = fixture.storage.sources.getNormalization("normalization-1")
  if (!old || !normalization) throw new TypeError("Missing source fixture")
  const capacity = { ...fixtureCapacity, id: "synthetic-v4-10k", maxRequestBytes: 10000 }
  let setup = StudySetupRevision.parse({
    ...old,
    id: "v4-ungranted-draft",
    analysis: {
      ...old.analysis,
      processing: {
        ...old.analysis.processing,
        synthesisVersion: BATCHED_VERIFICATION_VERSION,
        preprocessingVersion: "batched-capacity-4",
        capacityId: capacity.id,
      },
    },
  })
  const originals = reviewedSourceBlocks(setup, normalization).map((row) =>
    WindowOriginal.parse({
      editionId: setup.editionId,
      normalizationRevisionId: normalization.id,
      resourcePath: row.resourcePath,
      blockId: row.blockId,
      start: row.start,
      end: row.end,
      originalFragment: row.text,
      ...(row.pageLabel ? { pageLabel: row.pageLabel } : {}),
    }),
  )
  const windows = originals.map((span) => [span])
  const groupId = old.analysis.processing?.plan?.[0]?.groupId
  if (!groupId) throw new TypeError("Missing original structural group")
  setup = StudySetupRevision.parse({
    ...setup,
    analysis: {
      ...setup.analysis,
      processing: {
        ...setup.analysis.processing,
        plan: windows.map((window) => ({
          groupId,
          ranges: window.map(({ resourcePath, blockId, start, end }) => ({
            resourcePath,
            blockId,
            start,
            end,
          })),
        })),
      },
    },
  })
  const finding = (id: string, text: string, index = 0) => {
    const original = originals[index]
    if (!original) throw new TypeError("Missing original")
    return {
      id: ContentId.parse(id),
      text,
      sources: [
        SourceSpan.parse({
          ...original,
          end: original.start + 1,
          originalFragment: original.originalFragment.slice(0, 1),
        }),
      ],
    }
  }
  const maps = windows.map((_, index) =>
    ChapterPartMap.parse({
      partId: `map-${index}`,
      groupId,
      complete: true,
      claimStatus: "claims",
      purpose: null,
      claims: [finding(`map-${index}-claim`, "Synthetic map claim", index)],
      concepts: [],
      definitions: [],
      examples: [],
      qualifications: [],
      uncertainties: [],
      summary: finding(`map-${index}-summary`, "Synthetic map summary", index),
    }),
  )
  const synthesis = BookSynthesis.parse({
    strategy: "complete-maps",
    complete: true,
    representedGroupIds: maps.map((map) => map.groupId),
    thesis: [finding("global-0", "a".repeat(1600))],
    progression: Array.from({ length: 5 }, (_, index) =>
      finding(`global-${index + 1}`, String(index).repeat(1600)),
    ),
    connections: [],
    conflicts: [],
    changesOfPosition: [],
    uncertainties: [],
  })
  return {
    fixture,
    execution: { setup, normalization, capacity },
    windows,
    outputs: { maps, synthesis },
    finding,
  }
}
