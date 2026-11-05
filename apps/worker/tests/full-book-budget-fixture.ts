import { randomUUID } from "node:crypto"
import {
  FullBookTestConsent,
  FullBookTestSession,
  planFullBookTest,
  StudySetupRevision,
  WindowOriginal,
  wholeBookScope,
} from "@reading-studio/contracts"
import { sharedBudgetFixture } from "@reading-studio/storage/test-support"
import { fullBookSession } from "./full-book-test-fixture.ts"

export function inheritedConsentFixture() {
  const legacy = sharedBudgetFixture(),
    { storage } = legacy.fixture,
    setup = legacy.setup
  const normalization = storage.sources.getNormalization(setup.analysis.normalizationRevisionId)
  if (!normalization || !setup.analysis.destination)
    throw new TypeError("Missing legacy source/destination")
  storage.subscriptionConnections.disconnect(
    setup.analysis.destination.installationId,
    "chatgpt-subscription",
  )
  const current = StudySetupRevision.parse({
    ...setup,
    id: "full-book-budget-draft",
    studyId: "full-book-budget-study",
    analysis: { ...setup.analysis, scope: wholeBookScope(normalization) },
  })
  legacy.prepareNext(current)
  const blocks = normalization.resources.flatMap((resource) =>
    resource.status === "included" ? resource.blocks.map((block) => ({ resource, block })) : [],
  )
  const originals = blocks
    .filter(({ block }) => block.text.length > 0)
    .map(({ resource, block }) =>
      WindowOriginal.parse({
        editionId: normalization.editionId,
        normalizationRevisionId: normalization.id,
        resourcePath: resource.path,
        blockId: block.id,
        start: 0,
        end: block.text.length,
        originalFragment: block.text,
        ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
      }),
    )
  const first = originals[0]
  if (!first || [...first.originalFragment].length < 4)
    throw new TypeError("Missing splittable fixture")
  const scalars = [...first.originalFragment],
    slices = Array.from({ length: 4 }, (_, i) => {
      const start = scalars.slice(0, Math.floor((i * scalars.length) / 4)).join("").length
      const end = scalars.slice(0, Math.floor(((i + 1) * scalars.length) / 4)).join("").length
      return [{ ...first, start, end, originalFragment: first.originalFragment.slice(start, end) }]
    })
  const input = {
    ...fullBookSession().input,
    normalization,
    groups: [{ id: "all-groups", blockIds: blocks.map(({ block }) => block.id) }],
    windows: [...slices, ...(originals.length > 1 ? [originals.slice(1)] : [])],
    policy: { ...fullBookSession().input.policy, maxLevels: 8, maxNodes: 200, maxAttempts: 500 },
  }
  const session = FullBookTestSession.parse({
    enabled: true,
    purpose: "full-book-test-1",
    input,
    plan: planFullBookTest(input),
    destination: setup.analysis.destination,
    model: setup.analysis.model,
    settings: setup.analysis.settings,
  })
  const consent = FullBookTestConsent.parse({
    id: randomUUID(),
    version: "full-book-test-consent-1",
    transport: "synthetic-only-no-native-entry",
    ownerId: "owner-1",
    studyId: current.studyId,
    setupRevisionId: current.id,
    session,
    sourceCeiling: 100,
    acknowledgement: { coverage: normalization.coverage, omissions: normalization.omissions ?? [] },
    approvedAt: "2026-10-31T00:00:00.000Z",
  })
  return { legacy, consent }
}
