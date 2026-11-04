import { BookMapPipeline } from "@reading-studio/generation"
import { fixtureOutlineProvider } from "@reading-studio/generation/outline"
import { queueGenerationStage } from "@reading-studio/generation/provider-stages"
import { afterEach, expect, it, vi } from "vitest"
import { useManagedBookReplies } from "./managed-startup-fixture.ts"
import { completedInvocation, managedWorkflowFixture } from "./managed-workflow-fixture.ts"
import { approveBrief } from "./managed-workflow-outputs.ts"
import { preparedQuestions } from "./managed-workflow-steps.ts"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it("queues an approved-brief outline for a second study and exposes only verified model output", async () => {
  const flow = await managedWorkflowFixture()
  try {
    await preparedQuestions(flow)
    approveBrief(flow)
    const { storage } = flow
    const setup = storage.sources.getSetup(flow.setupId)
    const interview = storage.interviews.latest(flow.studyId)
    const currentBrief = storage.briefs.current(flow.studyId)
    const grant = storage.sources.getGrant(flow.grantId)
    if (!setup || !interview || !currentBrief || !grant)
      throw new TypeError("Incomplete managed fixture")
    storage.sources.createStudy({
      id: "study-2",
      ownerId: grant.ownerId,
      editionId: setup.editionId,
    })
    storage.sources.appendSetup({
      record: { ...setup, id: "setup-2", studyId: "study-2" },
      parentRevisionId: null,
    })
    storage.sources.appendGrant({ ...grant, id: "grant-2", setupRevisionId: "setup-2" })
    new BookMapPipeline(flow.authority()).prepare("setup-2", "grant-2")
    const automatic = useManagedBookReplies(flow)
    for (let step = 0; step < 7; step++) completedInvocation(await flow.invoke())
    automatic.mockRestore()
    expect(storage.interviews.latest("study-2")?.studyId).toBe("study-2")
    const draft = storage.briefs.save({
      studyId: "study-2",
      expectedRevisionId: null,
      content: currentBrief.draft.content,
    })
    storage.briefs.decide({ studyId: "study-2", revisionId: draft.id, action: "approve" })
    const brief = storage.briefs.approved(draft.id)
    const analysis = brief && storage.workflow.getAnalysis(brief.analysisRevisionId)
    if (!brief || !analysis) throw new TypeError("Approved analysis missing")
    const output = fixtureOutlineProvider({ brief, analysis, previous: null, feedback: null })
    queueGenerationStage(storage, "outline", brief.id, "setup-2", "grant-2")
    const before = (await flow.requests()).length
    const generated = await flow.invoke({ ...output, sections: output.sections.slice(0, 1) })
    expect(generated).toMatchObject({
      kind: "provider",
      job: { stage: "outline", state: "completed", setupRevisionId: "setup-2" },
    })
    expect(storage.outlines.current("study-2")).toBeNull()
    expect(await flow.requests()).toHaveLength(before + 1)
    await flow.invoke({ fixtureAction: "supported" })
    expect(storage.outlines.current("study-2")).toMatchObject({
      status: "pending",
      draft: { briefRevisionId: brief.id, studyId: "study-2" },
    })
    expect(storage.outlines.current("study-2")?.draft.content.sections).toHaveLength(1)
    expect(storage.outlines.current("study-2")?.draft.content.qualifications).toEqual(
      analysis.qualifications,
    )
    expect(storage.outlines.current(flow.studyId)).toBeNull()
    expect(await flow.requests()).toHaveLength(before + 2)
    expect(flow.network).not.toHaveBeenCalled()
  } finally {
    await flow.close()
  }
})
