import {
  AnswerSubmission,
  PublicationProjection,
  requiredTeachingStates,
  SceneSpec,
} from "@reading-studio/contracts"

const label = { en: "Quiet companionship", ja: "静かに寄り添う" }
const question = {
  id: "question-1",
  revisionId: "question-rev-1",
  analysisRevisionId: "analysis-1",
  prompt: label,
  mode: "single",
  options: [{ id: "option-1", label }],
  minSelections: 1,
  maxSelections: 1,
  policy: { custom: true, unsure: true, skip: true },
}
const answer = {
  kind: "choice",
  questionId: "question-1",
  questionRevisionId: "question-rev-1",
  optionIds: ["option-1"],
}
const scene = {
  id: "scene-1",
  kind: "layered-diagram",
  title: label,
  layers: [{ id: "layer-1", label, explanation: label }],
  practice: [],
}
const valid = AnswerSubmission.safeParse({ question, answer })
const invalidAnswer = AnswerSubmission.safeParse({
  question,
  answer: { ...answer, kind: "unsure" },
})
const invalidScene = SceneSpec.safeParse({ ...scene, shader: "forbidden" })
const invalidPublication = PublicationProjection.safeParse({
  title: label,
  sections: [
    { id: "section-1", heading: label, content: label, sourceNotes: [], scenes: [], practice: [] },
  ],
  assets: [],
  rawContext: "PRIVATE_CANARY",
})
const checks = [
  { label: "bilingual-choice-valid", passed: valid.success },
  { label: "exclusive-answer-rejected", passed: !invalidAnswer.success },
  { label: "executable-scene-rejected", passed: !invalidScene.success },
  { label: "private-publication-field-rejected", passed: !invalidPublication.success },
  {
    label: "trusted-states-derived",
    passed: requiredTeachingStates(SceneSpec.parse(scene)).length === 1,
  },
]
for (const check of checks) console.log(JSON.stringify(check))
if (checks.some((check) => !check.passed)) process.exitCode = 1
