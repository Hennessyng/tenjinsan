import { interviewFixture } from "@reading-studio/server/interview-fixture"

export async function briefFixture() {
  const fixture = await interviewFixture()
  const analysis = fixture.storage.workflow.getAnalysis(fixture.definition.analysisRevisionId)
  if (!analysis) throw new TypeError("Missing fixture analysis")
  fixture.storage.sources.appendSetup({
    parentRevisionId: null,
    record: {
      id: "setup-brief",
      studyId: fixture.definition.studyId,
      editionId: analysis.editionId,
      analysis: analysis.cacheInput,
      generation: {
        promptVersion: "generation-1",
        schemaVersion: "generation-1",
        settings: analysis.cacheInput.settings,
      },
    },
  })
  return fixture
}
