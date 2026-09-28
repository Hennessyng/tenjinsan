import {
  PublicationProjection,
  PublicationRevision,
  projectedStrings,
  projectionHash,
  publicationTeachingStateIds,
} from "@reading-studio/contracts"

export const states = [
  {
    id: "first",
    label: { en: "First view", ja: "最初の視点" },
    explanation: { en: "Notice the spoken words.", ja: "語られた言葉に注目します。" },
  },
  {
    id: "second",
    label: { en: "Second view", ja: "別の視点" },
    explanation: { en: "Separate inference from observation.", ja: "推測と観察を区別します。" },
  },
] as const
export const practice = [
  {
    id: "reflect",
    prompt: { en: "What could you ask?", ja: "何を尋ねますか？" },
    options: [
      {
        id: "ask",
        label: { en: "Ask", ja: "尋ねる" },
        feedback: { en: "A question allows correction.", ja: "質問は訂正の余地を残します。" },
      },
      {
        id: "guess",
        label: { en: "Guess", ja: "推測する" },
        feedback: { en: "A guess is not evidence.", ja: "推測は根拠ではありません。" },
      },
    ],
  },
] as const
const base = { title: { en: "Compare two states", ja: "二つの状態を比べる" }, practice }
const scenes = [
  { ...base, id: "layers", kind: "layered-diagram", layers: states },
  { ...base, id: "compare", kind: "comparison", variants: states },
  { ...base, id: "time", kind: "timeline", events: states },
  { ...base, id: "process", kind: "annotated-process", steps: states, loop: true },
  { ...base, id: "perspective", kind: "perspective-3d", viewpoints: states },
  { ...base, id: "spatial", kind: "spatial-layers-3d", layers: states, viewpoints: states },
]

export const breakout = '</script><script id="breakout">globalThis.pwned=1</script><!--\u2028\u2029'
export const exportProjection = PublicationProjection.parse({
  title: { en: "Offline reading", ja: "オフラインで読む" },
  sections: [
    {
      id: "attention",
      heading: { en: "Attention", ja: "注意" },
      content: { en: breakout, ja: "文字列は実行しません。" },
      scenes,
      practice,
      sourceNotes: [],
    },
  ],
  assets: [],
})

// Synthetic approval only. Production callers must supply the authoritative stored revision.
export function approved(input: unknown = exportProjection) {
  const projection = PublicationProjection.parse(input)
  const hash = projectionHash(projection)
  return PublicationRevision.parse({
    id: "publication-PRIVATE_ID_CANARY",
    lessonRevisionId: "lesson-PRIVATE_LESSON_CANARY",
    analysisRevisionId: "analysis-PRIVATE_ANALYSIS_CANARY",
    projection,
    projectionHash: hash,
    privacyReview: {
      id: "privacy-PRIVATE_REVIEW_CANARY",
      projectionHash: hash,
      reviewedPaths: projectedStrings(projection).map(({ path }) => path),
      findings: [],
      status: "passed",
    },
    approval: {
      projectionHash: hash,
      privacyReviewId: "privacy-PRIVATE_REVIEW_CANARY",
      evidenceReportHash: "a".repeat(64),
      rendererVersion: "1",
      requiredStateIds: publicationTeachingStateIds(projection),
      assetHashes: [...new Set(projection.assets.map((asset) => asset.contentHash))],
      approvedAt: "2026-09-24T00:00:00Z",
    },
  })
}
