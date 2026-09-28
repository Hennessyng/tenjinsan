import { PublicationProjection, projectedStrings, projectionHash } from "@reading-studio/contracts"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const HASH_C = "c".repeat(64)
const TIMESTAMP = "2026-09-21T00:00:00Z"

const settings = {
  temperature: 0,
  topP: 1,
  maxOutputTokens: 1000,
  seed: null,
  reasoningEffort: "default",
}

export function sourceFixtures() {
  const edition = {
    id: "edition-1",
    originalHash: HASH_A,
    originalBlobHash: HASH_A,
    title: "Synthetic edition",
  }
  const normalization = {
    id: "normalization-1",
    editionId: edition.id,
    editionHash: edition.originalHash,
    parserVersion: "parser-1",
    normalizerVersion: "normalizer-1",
    coverage: "complete",
    resources: [
      {
        path: "text/chapter.xhtml",
        role: "main-chapter",
        status: "included",
        blocks: [
          {
            id: "block-1",
            text: "Synthetic source text.",
            originalFragment: "Synthetic source text.",
            pageLabel: "1",
          },
        ],
      },
    ],
  }
  const setup = {
    id: "setup-1",
    studyId: "study-1",
    editionId: edition.id,
    analysis: {
      editionHash: edition.originalHash,
      normalizationRevisionId: normalization.id,
      scope: {
        kind: "all-main-chapters",
        selected: [{ resourcePath: "text/chapter.xhtml", blockIds: ["block-1"] }],
        exclusions: [],
      },
      provider: "openai",
      model: "fixture-model",
      analysisPromptVersion: "analysis-prompt-1",
      analysisSchemaVersion: "analysis-schema-1",
      settings,
    },
    generation: {
      promptVersion: "generation-prompt-1",
      schemaVersion: "generation-schema-1",
      settings,
    },
  }
  return { edition, normalization, setup }
}

export function completeGraphFixtures() {
  const source = sourceFixtures()
  const span = {
    editionId: source.edition.id,
    normalizationRevisionId: source.normalization.id,
    resourcePath: "text/chapter.xhtml",
    blockId: "block-1",
    start: 0,
    end: 9,
    originalFragment: "Synthetic",
    pageLabel: "1",
  }
  const grant = {
    kind: "active",
    id: "grant-1",
    setupRevisionId: source.setup.id,
    installationId: "installation-1",
    ownerId: "owner-1",
    categories: ["book-text"],
    approvedAt: TIMESTAMP,
  }
  const analysis = {
    id: "analysis-1",
    editionId: source.edition.id,
    cacheInput: source.setup.analysis,
    cacheKey: "",
    status: "successful",
    chapters: [{ resourcePath: "text/chapter.xhtml", blockIds: ["block-1"], status: "complete" }],
    claims: [{ id: "claim-1", text: "Synthetic claim", sources: [span] }],
    concepts: [],
    qualifications: [],
  }
  const question = {
    id: "question-1",
    revisionId: "question-revision-1",
    analysisRevisionId: analysis.id,
    prompt: { en: "Choose a focus", ja: "Choose a focus ja" },
    options: [{ id: "option-1", label: { en: "Focus", ja: "Focus ja" } }],
    policy: { custom: true, unsure: true, skip: true },
    mode: "single",
    minSelections: 1,
    maxSelections: 1,
  }
  const submission = {
    question,
    answer: {
      kind: "choice",
      questionId: question.id,
      questionRevisionId: question.revisionId,
      optionIds: ["option-1"],
    },
  }
  const brief = {
    id: "brief-1",
    studyId: source.setup.studyId,
    setupRevisionId: source.setup.id,
    analysisRevisionId: analysis.id,
    guidingQuestion: { en: "What matters?", ja: "What matters ja?" },
    supportingQuestions: [],
    purpose: "Synthetic purpose",
    context: "Synthetic context",
    depth: "focused",
    spoilerPolicy: "avoid",
    language: "paired",
    exclusions: [],
    answers: [submission],
    approval: { revisionId: "brief-1", approvedAt: TIMESTAMP },
  }
  const outline = {
    id: "outline-1",
    studyId: source.setup.studyId,
    setupRevisionId: source.setup.id,
    analysisRevisionId: analysis.id,
    briefRevisionId: brief.id,
    sections: [
      {
        id: "outline-section-1",
        title: { en: "Section", ja: "Section ja" },
        learningGoals: [{ en: "Learn", ja: "Learn ja" }],
        theme: { en: "Theme", ja: "Theme ja" },
        visualIntents: [],
        sources: [span],
      },
    ],
    approval: { revisionId: "outline-1", approvedAt: TIMESTAMP },
  }
  const lesson = {
    id: "lesson-1",
    studyId: source.setup.studyId,
    setupRevisionId: source.setup.id,
    analysisRevisionId: analysis.id,
    briefRevisionId: brief.id,
    outlineRevisionId: outline.id,
    sections: [
      {
        id: "lesson-section-1",
        title: { en: "Lesson", ja: "Lesson ja" },
        content: { en: "Synthetic lesson", ja: "Synthetic lesson ja" },
        attribution: { kind: "original-example" },
        reviewerFlags: [],
        scenes: [],
        practice: [],
      },
    ],
    coverage: { kind: "complete-approved-scope", sources: [span], limitations: [] },
  }
  const projection = PublicationProjection.parse({
    title: { en: "Published lesson", ja: "Published lesson ja" },
    sections: [
      {
        id: "publication-section-1",
        heading: { en: "Heading", ja: "Heading ja" },
        content: { en: "Public synthetic content", ja: "Public synthetic content ja" },
        sourceNotes: [],
        scenes: [],
        practice: [],
      },
    ],
    assets: [],
  })
  const digest = projectionHash(projection)
  const evidenceReport = { hash: HASH_B, lessonRevisionId: lesson.id, flags: [] }
  const privacyReview = {
    id: "privacy-1",
    projectionHash: digest,
    reviewedPaths: projectedStrings(projection).map((entry) => entry.path),
    findings: [],
    status: "passed",
  }
  const publication = {
    id: "publication-1",
    lessonRevisionId: lesson.id,
    analysisRevisionId: analysis.id,
    projection,
    projectionHash: digest,
    privacyReview,
    approval: {
      projectionHash: digest,
      privacyReviewId: privacyReview.id,
      evidenceReportHash: HASH_B,
      rendererVersion: "renderer-1",
      requiredStateIds: [],
      assetHashes: [],
      approvedAt: TIMESTAMP,
    },
  }
  const run = {
    id: "run-1",
    inputRevisionId: "input-1",
    budget: {
      maxCalls: 1,
      maxSourceCharacters: 1000,
      maxOutputTokens: 1000,
      maxTransientRetries: 0,
      maxSchemaRepairs: 0,
    },
    reservedCalls: 1,
    state: "completed",
  }
  const attempt = {
    id: "attempt-1",
    runId: run.id,
    reservation: 1,
    inputRevisionId: run.inputRevisionId,
    preparedAt: TIMESTAMP,
    state: "prepared",
  }
  const job = {
    id: "job-1",
    runId: run.id,
    inputRevisionId: run.inputRevisionId,
    setupRevisionId: source.setup.id,
    provider: "openai",
    model: "fixture-model",
    promptVersion: "generation-prompt-1",
    schemaVersion: "generation-schema-1",
    grant,
    stage: "artifact",
    checkpoint: null,
    cancellationRequested: false,
    usage: { kind: "unknown" },
    state: "queued",
  }
  const artifact = {
    id: "artifact-1",
    publicationRevisionId: publication.id,
    projectionHash: digest,
    format: "html",
    contentHash: HASH_C,
    embeddedAssetHashes: [],
    teachingStateIds: [],
    validation: { status: "passed", reportHash: HASH_B },
    provenance: { jobId: job.id, rendererVersion: "renderer-1", createdAt: TIMESTAMP },
  }
  return {
    ...source,
    grant,
    analysis,
    question,
    submission,
    brief,
    outline,
    lesson,
    evidenceReport,
    privacyReview,
    publication,
    run,
    attempt,
    job,
    artifact,
  }
}
