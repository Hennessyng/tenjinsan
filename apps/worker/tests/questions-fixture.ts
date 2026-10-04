import { AnalysisCacheInput, analysisCacheKey } from "@reading-studio/contracts"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"

export function questionsFixture() {
  const base = completeGraphFixtures()
  const spans = [
    {
      editionId: "edition-1",
      normalizationRevisionId: "normalization-1",
      resourcePath: "listen.xhtml",
      blockId: "listen",
      start: 0,
      end: 24,
      originalFragment: "Ask before giving advice",
    },
    {
      editionId: "edition-1",
      normalizationRevisionId: "normalization-1",
      resourcePath: "quiet.xhtml",
      blockId: "quiet",
      start: 0,
      end: 25,
      originalFragment: "Respect a wish for quiet.",
    },
  ]
  const cacheInput = AnalysisCacheInput.parse({
    ...base.analysis.cacheInput,
    scope: {
      kind: "all-main-chapters",
      selected: spans.map((span) => ({
        resourcePath: span.resourcePath,
        blockIds: [span.blockId],
      })),
      exclusions: [],
    },
  })
  const analysis = {
    ...base.analysis,
    cacheInput,
    cacheKey: analysisCacheKey(cacheInput),
    chapters: spans.map((span) => ({
      resourcePath: span.resourcePath,
      blockIds: [span.blockId],
      status: "complete",
    })),
    claims: spans.map((span, i) => ({
      id: `claim-${i}`,
      text: span.originalFragment,
      sources: [span],
    })),
    concepts: [],
    qualifications: [],
  }
  const labels = [
    { en: "Ask before advising", ja: "助言の前に尋ねる" },
    { en: "Respect quiet company", ja: "静かな付き添いを尊重する" },
  ]
  const lenses = spans.map((span, i) => ({
    id: `lens-${i}`,
    revisionId: `question-rev-${i}`,
    groupId: `group-${i}`,
    learningGoalKey: `goal-${i}`,
    label: labels[i],
    rationale: {
      en: span.originalFragment,
      ja: i === 0 ? "相手の希望を確かめる練習です。" : "話を求めない支え方を学びます。",
    },
    sources: [span],
    complications: [
      { label: { en: "Do not force disclosure", ja: "開示を強要しない" }, sources: [span] },
    ],
    prompt: { en: "Which skill would you practice?", ja: "どの技能を練習しますか？" },
    mode: "single",
    minSelections: 1,
    maxSelections: 1,
    options: [
      {
        id: `option-${i}-a`,
        goalKey: "notice",
        label: { en: "Notice the preference", ja: "希望に気づく" },
        rationale: { en: "Start with observation", ja: "観察から始める" },
      },
      {
        id: `option-${i}-b`,
        goalKey: "practice",
        label: { en: "Practice a response", ja: "応答を練習する" },
        rationale: { en: "Rehearse an action", ja: "行動を練習する" },
      },
    ],
  }))
  const context = {
    revisionId: "context-1",
    studyId: "study-1",
    preferredGoalKeys: ["goal-1"],
    customQuestion: "How can I help without pressing?",
  }
  return {
    input: {
      analysis,
      context,
      expected: {
        analysisRevisionId: "analysis-1",
        contextRevisionId: "context-1",
        studyId: "study-1",
      },
    },
    draft: {
      analysisRevisionId: "analysis-1",
      contextRevisionId: "context-1",
      groups: [
        { id: "group-0", label: { en: "Conversation", ja: "対話" } },
        { id: "group-1", label: { en: "Presence", ja: "付き添い" } },
      ],
      lenses,
    },
  }
}
