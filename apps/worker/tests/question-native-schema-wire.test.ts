import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { questionReferenceContract } from "../src/question-reference-contract.ts"
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

it("uses the native schema slot for synthetic reference-only questions", async () => {
  // Given
  flow = await managedWorkflowFixture()
  await preparedAnalysis(flow)
  const job = pendingQuestions(flow)
  const { draft } = managedQuestionOutput(flow, job)
  const setup = flow.storage.sources.getSetup(job.setupRevisionId)
  const analysis = flow.analysis()
  const normalization =
    setup && flow.storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  if (!setup || !normalization) throw new TypeError("Missing synthetic source")
  const contract = questionReferenceContract({
    setup,
    analysis,
    normalization,
    contextRevisionId: job.inputRevisionId,
  })
  const wire = {
    version: "question-evidence-refs-v1",
    binding: contract.catalog.binding,
    groups: draft.groups,
    lenses: draft.lenses.map(({ revisionId: _revisionId, sources, complications, ...lens }) => ({
      ...lens,
      evidenceRefs: sources.map(contract.catalog.reference),
      complications: complications.map(({ label, sources: refs }) => ({
        label,
        evidenceRefs: refs.map(contract.catalog.reference),
      })),
    })),
  }
  // When
  const result = completedInvocation(await flow.invoke(wire))
  // Then
  expect(result.stage).toBe("questions")
  expect(flow.storage.interviews.latest(flow.studyId)).toBeNull()
  const requests = await flow.requests()
  expect(requests.at(-1)?.outputSchema).toBeDefined()
  const attempt = flow.storage.execution.listAttempts(job.runId)[0]
  const receipt = attempt && flow.storage.execution.getAttemptReceipt(attempt.id)
  if (!receipt) throw new TypeError("Missing synthetic receipt")
  expect(
    z
      .object({ outputFormat: z.literal("native-json-schema") })
      .safeParse(JSON.parse(new TextDecoder().decode(receipt))).success,
  ).toBe(true)
  expect(flow.network).not.toHaveBeenCalled()
  expect(flow.login).not.toHaveBeenCalled()
})
