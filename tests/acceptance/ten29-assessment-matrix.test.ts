import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { authorIntentions } from "./ten29/assessment-v2/author-intentions.ts"
import { negativeKinds } from "./ten29/assessment-v2/control-types.ts"
import { candidateBodies, familyNarratives } from "./ten29/assessment-v2/controls.ts"
import { exerciseAssessmentCase } from "./ten29/assessment-v2/exercise-case.ts"
import forms from "./ten29/assessment-v2/forms.json"
import protocol from "./ten29/assessment-v2/protocol-freeze.json"
import rubric from "./ten29/assessment-v2/rubric.json"
import { projectSource } from "./ten29/assessment-v2/source-projection.ts"
import { corpus, formats } from "./ten29/corpus-support.ts"
import { evidenceDirectory, repoPath } from "./ten29/evidence.ts"
import { persistedCorpus } from "./ten29/persisted-corpus.ts"

it("retains frozen protocol anchors and empty human forms without grading candidates", () => {
  const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex")
  for (const file of protocol.files)
    expect(sha(readFileSync(repoPath(file.path)))).toBe(file.sha256)
  expect(sha(JSON.stringify(protocol.files))).toBe(protocol.filesCommitment)
  expect(rubric.dimensions).toHaveLength(7)
  expect(
    rubric.dimensions.every((dimension) => dimension["0"] && dimension["1"] && dimension["2"]),
  ).toBe(true)
  expect(rubric.threshold).toEqual({
    minimumEach: 1,
    minimumTotal: 12,
    maximumTotal: 14,
    criticalOverridesTotal: true,
  })
  expect(rubric.criticalFlags).toHaveLength(6)
  expect(forms.sourceFirst.chapters).toEqual([])
  expect(forms.sourceFirst.crossBookQuestionsAndAnswers).toEqual([])
  expect(forms.candidateFirstPass.dimensionScores).toBeNull()
  expect(forms.candidateFirstPass.criticalFlags).toBeNull()
})
it("separates provisional author intentions from candidate content and human reference labels", () => {
  const intentions = authorIntentions()
  expect(intentions.map((row) => row.privateId)).toEqual(
    candidateBodies.map((row) => row.privateId),
  )
  expect(intentions.filter((row) => row.intendedLabel === "faithful")).toHaveLength(8)
  expect(
    intentions.every(
      (row) => row.humanCorroboration === "UNCONFIRMED" && row.humanReferenceLabel === null,
    ),
  ).toBe(true)
  expect(
    candidateBodies.every(
      (candidate) => !("intendedLabel" in candidate) && !("humanReferenceLabel" in candidate),
    ),
  ).toBe(true)
})

it.each(corpus)(
  "has a bounded complete candidate matrix for $id before materialization",
  (family) => {
    // Given the new protocol's four immutable source families
    const candidates = candidateBodies.filter((candidate) => candidate.family === family.id)
    // When enumerating the author-authored scripts (not grading their truth)
    const ids = candidates.map((candidate) => candidate.privateId)
    // Then the substantive candidate inventory exists and stays finite
    expect(candidates.length).toBeGreaterThanOrEqual(6)
    expect(candidates.length).toBeLessThanOrEqual(8)
    expect(new Set(ids).size).toBe(ids.length)
    expect(
      candidates.every(
        (candidate) => candidate.thesis.length > 0 && candidate.progression.length > 0,
      ),
    ).toBe(true)
  },
)
it.each(familyNarratives)(
  "accounts explicitly for every negative type in $family without creating source disputes",
  (family) => {
    expect(
      [
        ...family.negatives.map((row) => row.kind),
        ...family.inapplicable.map((row) => row.kind),
      ].sort(),
    ).toEqual([...negativeKinds].sort())
    expect(family.inapplicable.every((row) => row.reason.length > 0)).toBe(true)
    const source = corpus.find((row) => row.id === family.family)
    if (!source) throw new TypeError("Missing original family")
    for (const row of family.negatives)
      if (row.quote)
        expect(row.parts.some((index) => source.parts[index]?.text.includes(row.quote ?? ""))).toBe(
          true,
        )
  },
)
it.each(corpus)(
  "proves ordered normalized text/part bijections in all four formats for $id",
  async (family) => {
    const directory = await evidenceDirectory("source-bijections")
    const projections = []
    for (const format of formats) {
      const fixture = await persistedCorpus(family, format, { draftOnly: true })
      try {
        const projection = projectSource(family, fixture.normalization)
        projections.push({
          format,
          originalHash: fixture.edition.originalHash,
          normalization: fixture.normalization,
          projection,
        })
        expect(() =>
          projectSource(family, { ...fixture.normalization, coverage: "partial" }),
        ).toThrow("complete extraction")
        expect(() =>
          projectSource(
            {
              ...family,
              parts: family.parts.map((part, index) =>
                index === 2 ? (family.parts[1] ?? part) : part,
              ),
            },
            fixture.normalization,
          ),
        ).toThrow("bijection")
        if (family.id === "mixed")
          expect(() =>
            projectSource(
              {
                ...family,
                parts: family.parts.map((part) => ({ ...part, text: part.text.normalize("NFC") })),
              },
              fixture.normalization,
            ),
          ).toThrow("bijection")
        expect(() =>
          projectSource({ ...family, parts: [...family.parts].reverse() }, fixture.normalization),
        ).toThrow("bijection")
        expect(() =>
          projectSource(
            {
              ...family,
              parts: family.parts.map((part, index) =>
                index === 1 ? { ...part, text: part.text + "x" } : part,
              ),
            },
            fixture.normalization,
          ),
        ).toThrow("bijection")
      } finally {
        await fixture.close()
      }
    }
    expect(new Set(projections.map((row) => row.projection.canonicalSha256)).size).toBe(1)
    expect(new Set(projections.map((row) => row.originalHash)).size).toBe(4)
    await writeFile(
      join(directory, "source-equivalence.json"),
      JSON.stringify(
        {
          family: family.id,
          projections,
          inheritedAssessment:
            "ELIGIBLE only after candidate/citation bijection and human assessment; NOT assessed",
          independentBooks: 1,
        },
        null,
        2,
      ),
    )
  },
  30000,
)
const runs = [
  ...candidateBodies.map((candidate) => ({ candidate, format: "epub" as const })),
  ...familyNarratives.flatMap((family) => {
    const candidate = candidateBodies.find((row) => row.family === family.family)
    if (!candidate) throw new TypeError("Missing representative candidate")
    return (["docx", "txt", "pdf"] as const).map((format) => ({ candidate, format }))
  }),
]
it.each(runs)(
  "persists scripted v4 $candidate.privateId in $format without semantic judging",
  async ({ candidate, format }) => {
    const evidence = await exerciseAssessmentCase(candidate, format)
    expect(evidence.analysis?.status).toBe("successful")
    expect(evidence.setup.analysis.processing?.preprocessingVersion).toBe("batched-room-5")
    expect(evidence.setup.analysis.processing?.synthesisVersion).toBe("batched-original-check-4")
    expect(evidence.persistedSha256).toBe(evidence.reopenedSha256)
    expect(evidence.counts).toMatchObject({
      questions: 0,
      outlines: 0,
      lessons: 0,
      publications: 0,
      artifacts: 0,
    })
    expect(evidence.humanAssessment).toBe("NOT STARTED")
    const directory = await evidenceDirectory("candidate-materialization")
    await writeFile(join(directory, "pipeline.json"), JSON.stringify(evidence, null, 2))
  },
  60000,
)
