import {
  LOCAL_CHATGPT_INFERENCE_POLICY,
  StudySetupRevision,
  wholeBookScope,
} from "@reading-studio/contracts"
import { proposeNormalBatchedDraft } from "@reading-studio/generation"
import { sharedBudgetFixture } from "@reading-studio/storage/test-support"
import { evaluationPurpose } from "./analysis-purpose-fixture.ts"
import {
  bookFixtureAuthority,
  bookFixtureCapacity,
  closeBookRoute,
} from "./book-map-route-fixture.ts"
import { wholeBookWorker } from "./whole-book-fixture.ts"

export async function sharedAnalysisPurposeFixture() {
  const shared = sharedBudgetFixture(),
    base = shared.fixture
  try {
    base.storage.liveStudyBudget.adopt(shared.adoption)
    const previous = base.storage.sources.getSetup("setup-live")
    const normalization =
      previous && base.storage.sources.getNormalization(previous.analysis.normalizationRevisionId)
    if (!previous || !normalization) throw new TypeError("Missing shared synthetic source")
    const fixture = {
      directory: base.directory,
      databasePath: base.options.databasePath,
      privateDataRoot: base.options.privateDataRoot,
      get storage() {
        return base.storage
      },
      close: async () => {
        await closeBookRoute(base.storage)
        base.close()
      },
    }
    bookFixtureAuthority(fixture)
    const setup = StudySetupRevision.parse({
      ...previous,
      id: "setup-next",
      studyId: "study-next",
      analysis: {
        ...previous.analysis,
        purpose: evaluationPurpose,
        scope: wholeBookScope(normalization),
        provider: bookFixtureCapacity.provider,
        model: bookFixtureCapacity.model,
        destination: bookFixtureCapacity.destination,
        analysisPromptVersion: "whole-book-2",
        analysisSchemaVersion: "whole-book-2",
        processing: {
          inferencePolicyVersion: LOCAL_CHATGPT_INFERENCE_POLICY,
          preprocessingVersion: "batched-room-5",
          synthesisVersion: "batched-original-check-4",
          capacityId: bookFixtureCapacity.id,
        },
      },
    })
    const cap = base.storage.liveStudyBudget.analysisAllowance(
      "owner-1",
      setup.analysis.editionHash,
    )
    const proposal = await proposeNormalBatchedDraft({
      setup,
      normalization,
      capacity: bookFixtureCapacity,
      cap,
      used: 0,
    })
    if (proposal.kind !== "ready")
      throw new TypeError(`Shared evaluation refused: ${proposal.reason}`)
    const target = {
      ...shared.prepareNext(proposal.setup),
      purpose: evaluationPurpose,
      grantId: `grant-${setup.id}`,
    }
    base.storage.liveStudyBudget.approve({ ownerId: "owner-1", target })
    await closeBookRoute(base.storage)
    base.reopen(target)
    bookFixtureAuthority(fixture)
    const grant = base.storage.sources.appendGrant({
      id: target.grantId,
      kind: "active",
      setupRevisionId: setup.id,
      ownerId: "owner-1",
      installationId: "installation-1",
      approvedAt: "2026-10-23T00:00:00.000Z",
      categories: ["book-text", "derived-study-material"],
      purpose: evaluationPurpose,
      destination: setup.analysis.destination,
    })
    return {
      ...shared,
      fixture,
      setup: proposal.setup,
      grant,
      normalization,
      target,
      runtime: () => wholeBookWorker(fixture, undefined, bookFixtureCapacity),
    }
  } catch (error) {
    await closeBookRoute(base.storage)
    base.close()
    throw error
  }
}
