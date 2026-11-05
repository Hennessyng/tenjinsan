import type { Job } from "@reading-studio/contracts"
import { fixtureOutlineProvider } from "@reading-studio/generation/outline"
import { managedQuestionOutput } from "./managed-question-fixture.ts"
import type { ManagedWorkflow } from "./managed-workflow-fixture.ts"

export const pair = (en: string, ja = "合成の学習内容") => ({ en, ja })
export function chapterOutput(flow: ManagedWorkflow) {
  const setup = flow.storage.sources.getSetup(flow.setupId)
  const normalization =
    setup && flow.storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  const resource = normalization?.resources.find((resource) => resource.status === "included")
  const block =
    resource?.status === "included"
      ? resource.blocks.find((block) => block.text.length > 0)
      : undefined
  if (!resource || !block) throw new TypeError("Missing synthetic source")
  const statement = {
    text: "Synthetic interpretation, bounded by the qualification",
    citations: [
      { resourcePath: resource.path, blockId: block.id, start: 0, end: block.text.length },
    ],
  }
  return {
    complete: true,
    claimStatus: "claims",
    purpose: statement,
    claims: [statement],
    concepts: [],
    definitions: [],
    examples: [],
    qualifications: [statement],
    uncertainties: [],
    summary: statement,
  }
}
export function synthesisOutput(flow: ManagedWorkflow) {
  const maps = flow.analysis().wholeBook
  const summary = maps?.maps[0]?.summary
  if (!maps || !summary) throw new TypeError("Missing chapter map")
  const statement = {
    text: "Synthetic progression with a retained limit",
    citations: summary.sources.map(({ resourcePath, blockId, start, end }) => ({
      resourcePath,
      blockId,
      start,
      end,
    })),
  }
  return {
    complete: true,
    representedGroupIds: maps.groups.map((group) => group.id),
    thesis: [statement],
    progression: [statement],
    connections: [],
    conflicts: [],
    changesOfPosition: [],
    uncertainties: [],
  }
}
export function questionOutput(flow: ManagedWorkflow, job: Job) {
  return managedQuestionOutput(flow, job).wire
}
export function approveBrief(flow: ManagedWorkflow) {
  const draft = flow.storage.briefs.save({
    studyId: flow.studyId,
    expectedRevisionId: null,
    content: {
      originalQuestion: pair("What does the source support?"),
      refinedQuestion: null,
      questionChoice: "original",
      supportingQuestions: [pair("Where is the qualification?")],
      purpose: "Synthetic test",
      context: "Synthetic context only",
      depth: "focused",
      language: "paired",
      spoilerPolicy: "avoid",
      exclusions: ["Synthetic excluded area"],
    },
  })
  flow.storage.briefs.decide({ studyId: flow.studyId, revisionId: draft.id, action: "approve" })
  const brief = flow.storage.briefs.approved(draft.id)
  if (!brief) throw new TypeError("Missing approved synthetic brief")
  return brief
}
export function outlineOutput(flow: ManagedWorkflow, briefId: string) {
  const brief = flow.storage.briefs.approved(briefId)
  if (!brief) throw new TypeError("Missing approved brief")
  return fixtureOutlineProvider({
    brief,
    analysis: flow.analysis(),
    previous: null,
    feedback: null,
  })
}
