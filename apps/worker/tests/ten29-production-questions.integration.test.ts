import { afterEach, expect, it, vi } from "vitest"
import { managedQuestionOutput } from "./managed-question-fixture.ts"
import {
  completedInvocation,
  type ManagedWorkflow,
  managedWorkflowFixture,
} from "./managed-workflow-fixture.ts"
import { pendingQuestions, preparedAnalysis } from "./managed-workflow-steps.ts"

let flow: ManagedWorkflow | undefined
afterEach(async () => {
  await flow?.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it("persists selectable cited questions through the managed RPC only after original verification", async () => {
  flow = await managedWorkflowFixture()
  await preparedAnalysis(flow)
  const analysis = flow.analysis()
  const job = pendingQuestions(flow)
  const { wire, source } = managedQuestionOutput(flow, job)
  const generated = completedInvocation(await flow.invoke(wire))
  expect(generated.stage).toBe("questions")
  expect(flow.storage.interviews.latest(flow.studyId)).toBeNull()
  expect(flow.storage.execution.listAttempts(job.runId)).toHaveLength(1)
  expect(await flow.requests()).toHaveLength(6)
  completedInvocation(await flow.invoke({ fixtureAction: "supported" }))
  const question = flow.storage.interviews.latest(flow.studyId)?.steps[0]?.question
  expect(question?.options).toHaveLength(2)
  expect(question?.analysisRevisionId).toBe(analysis.id)
  expect(analysis.claims[0]?.sources[0]).toEqual(source)
  expect(await flow.requests()).toHaveLength(7)
  expect(flow.network).not.toHaveBeenCalled()
  expect(flow.login).not.toHaveBeenCalled()
})
