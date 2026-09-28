import {
  AnalysisCacheInput,
  analysisCacheKey,
  InterviewDefinition,
} from "@reading-studio/contracts"
import { sourceViewerFixture } from "./source-viewer-fixture.ts"

export async function interviewFixture() {
  const fixture = await sourceViewerFixture()
  const cacheInput = AnalysisCacheInput.parse({
    editionHash: "a".repeat(64),
    normalizationRevisionId: "revision-fixture",
    scope: {
      kind: "partial",
      selected: [{ resourcePath: "chapter-one.xhtml", blockIds: ["opening", "passage", "unsafe"] }],
      exclusions: [{ resourcePath: "chapter-two.xhtml", blockIds: ["second"] }],
    },
    provider: "openai",
    model: "fixture",
    analysisPromptVersion: "analysis-1",
    analysisSchemaVersion: "analysis-1",
    settings: {
      temperature: 0,
      topP: 1,
      maxOutputTokens: 1000,
      seed: null,
      reasoningEffort: "default",
    },
  })
  const source = {
    editionId: "edition-fixture",
    normalizationRevisionId: "revision-fixture",
    resourcePath: "chapter-one.xhtml",
    blockId: "opening",
    start: 0,
    end: 9,
    originalFragment: "Attention",
  }
  fixture.storage.workflow.appendAnalysis({
    parentRevisionId: null,
    record: {
      id: "analysis-interview",
      editionId: "edition-fixture",
      cacheInput,
      cacheKey: analysisCacheKey(cacheInput),
      status: "successful",
      chapters: [
        {
          resourcePath: "chapter-one.xhtml",
          blockIds: ["opening", "passage", "unsafe"],
          status: "complete",
        },
      ],
      claims: [{ id: "attention", text: "Attention begins with a question.", sources: [source] }],
      concepts: [],
      qualifications: [],
    },
  })
  const common = {
    analysisRevisionId: "analysis-interview",
    policy: { custom: true, unsure: true, skip: true },
    minSelections: 1,
  }
  const definition = InterviewDefinition.parse({
    id: "interview-fixture",
    studyId: "study-fixture",
    analysisRevisionId: "analysis-interview",
    contextRevisionId: "context-fixture",
    groups: [
      { id: "attention", label: { en: "Attention and listening", ja: "注意と傾聴" } },
      { id: "practice", label: { en: "Practice and boundaries", ja: "実践と境界" } },
    ],
    shortlist: ["angle", "context", "decision"],
    steps: [
      {
        groupId: "attention",
        purpose: "preference",
        question: {
          ...common,
          id: "angle",
          revisionId: "angle-v1",
          mode: "single",
          maxSelections: 1,
          prompt: { en: "Where would you like to begin?", ja: "どこから読み始めたいですか？" },
          lens: {
            label: { en: "A closer kind of attention", ja: "より深く注意を向ける" },
            sources: [source],
          },
          options: [
            {
              id: "listen",
              label: { en: "Listen before interpreting", ja: "解釈する前に耳を傾ける" },
            },
            {
              id: "ask",
              label: { en: "Ask a more open question", ja: "より開かれた問いを立てる" },
            },
          ],
        },
      },
      {
        groupId: "practice",
        purpose: "preference",
        question: {
          ...common,
          id: "context",
          revisionId: "context-v1",
          mode: "multi",
          maxSelections: 2,
          prompt: { en: "Where could this matter to you?", ja: "どんな場面で役立てたいですか？" },
          options: [
            { id: "work", label: { en: "At work", ja: "職場で" } },
            { id: "home", label: { en: "At home", ja: "家庭で" } },
            { id: "community", label: { en: "In my community", ja: "地域で" } },
          ],
        },
      },
      {
        groupId: "practice",
        purpose: "approval",
        question: {
          ...common,
          id: "decision",
          revisionId: "decision-v1",
          mode: "single",
          maxSelections: 1,
          policy: { custom: false, unsure: false, skip: false },
          prompt: {
            en: "How would you like to handle these responses?",
            ja: "回答をどう扱いますか？",
          },
          options: [
            { id: "approve", label: { en: "Approve these responses", ja: "この回答を承認する" } },
            { id: "revise", label: { en: "Revise before proceeding", ja: "進む前に修正する" } },
            { id: "defer", label: { en: "Defer this decision", ja: "判断を保留する" } },
          ],
        },
      },
      {
        groupId: "attention",
        purpose: "preference",
        question: {
          ...common,
          id: "extra",
          revisionId: "extra-v1",
          mode: "single",
          maxSelections: 1,
          prompt: { en: "Explore another perspective", ja: "別の視点を探る" },
          options: [
            { id: "reflect", label: { en: "Reflect on silence", ja: "沈黙について考える" } },
          ],
        },
      },
    ],
  })
  fixture.storage.interviews.create(definition)
  return { ...fixture, definition }
}
