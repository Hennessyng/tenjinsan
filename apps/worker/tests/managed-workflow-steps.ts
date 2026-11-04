import { queueGenerationStage } from "@reading-studio/generation/provider-stages"
import { expect } from "vitest"
import { completedInvocation, type ManagedWorkflow } from "./managed-workflow-fixture.ts"
import {
  approveBrief,
  chapterOutput,
  outlineOutput,
  questionOutput,
  synthesisOutput,
} from "./managed-workflow-outputs.ts"

export async function preparedAnalysis(flow: ManagedWorkflow) {
  const first = completedInvocation(await flow.invoke(chapterOutput(flow)))
  expect(first.stage).toBe("analysis")
  expect(await flow.requests()).toHaveLength(1)
  expect(flow.analysis().status).toBe("partial")
  completedInvocation(await flow.invoke(synthesisOutput(flow)))
  expect(await flow.requests()).toHaveLength(2)
  expect(flow.analysis().status).toBe("partial")
  completedInvocation(await flow.invoke({ fixtureAction: "supported" }))
  expect(await flow.requests()).toHaveLength(3)
  expect(flow.analysis().status).toBe("partial")
  completedInvocation(await flow.invoke({ fixtureAction: "supported" }))
  expect(await flow.requests()).toHaveLength(4)
  expect(flow.analysis().status).toBe("partial")
  completedInvocation(await flow.invoke({ fixtureAction: "supported" }))
  expect(await flow.requests()).toHaveLength(5)
  expect(flow.analysis().status).toBe("successful")
  expect(flow.storage.interviews.latest(flow.studyId)).toBeNull()
}
export function pendingQuestions(flow: ManagedWorkflow) {
  const job = flow.storage.execution
    .listSetupJobs(flow.setupId)
    .find((job) => job.stage === "questions")
  if (!job) throw new TypeError("Missing queued questions")
  return job
}
export async function preparedQuestions(flow: ManagedWorkflow) {
  await preparedAnalysis(flow)
  const questions = completedInvocation(
    await flow.invoke(questionOutput(flow, pendingQuestions(flow))),
  )
  expect(questions.stage).toBe("questions")
  expect(await flow.requests()).toHaveLength(6)
  expect(flow.storage.interviews.latest(flow.studyId)).toBeNull()
  completedInvocation(await flow.invoke({ fixtureAction: "supported" }))
  expect(await flow.requests()).toHaveLength(7)
  const bank = flow.storage.interviews.latest(flow.studyId)
  if (!bank) throw new TypeError("Missing verified question bank")
  return bank
}
export async function generatedOutline(flow: ManagedWorkflow) {
  await preparedQuestions(flow)
  const brief = approveBrief(flow)
  queueGenerationStage(flow.storage, "outline", brief.id, flow.setupId, flow.grantId)
  expect(await flow.requests()).toHaveLength(7)
  const job = completedInvocation(await flow.invoke(outlineOutput(flow, brief.id)))
  expect(job.stage).toBe("outline")
  expect(await flow.requests()).toHaveLength(8)
  expect(flow.storage.outlines.current(flow.studyId)).toBeNull()
  return job
}
export async function approvedOutline(flow: ManagedWorkflow) {
  await generatedOutline(flow)
  completedInvocation(await flow.invoke({ fixtureAction: "supported" }))
  expect(await flow.requests()).toHaveLength(9)
  const outline = flow.storage.outlines.current(flow.studyId)
  if (!outline) throw new TypeError("Missing verified outline draft")
  expect(outline.status).toBe("pending")
  flow.storage.outlines.decide({
    studyId: flow.studyId,
    revisionId: outline.draft.id,
    action: "approve",
  })
  queueGenerationStage(flow.storage, "lesson", outline.draft.id, flow.setupId, flow.grantId)
  expect(await flow.requests()).toHaveLength(9)
  return outline.draft
}
