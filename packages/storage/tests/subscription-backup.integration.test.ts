import {
  AnalysisCacheInput,
  analysisCacheKey,
  TransmissionAuthorization,
} from "@reading-studio/contracts"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { captureLibrary, restoreLibrary } from "../src/backup.ts"
import { openStorage } from "../src/index.ts"
import { cleanupLibraries, library } from "./backup-fixture.ts"
import { completeGraphFixtures } from "./fixtures.ts"

const network = vi.fn(async () => {
  throw new TypeError("Network forbidden in subscription backup tests")
})
beforeEach(() => {
  network.mockClear()
  vi.stubGlobal("fetch", network)
})
afterEach(() => {
  cleanupLibraries()
  vi.unstubAllGlobals()
})
it("restores readable subscription history without connection or account identity", () => {
  // Given
  const paths = library("owner-1", true)
  const destinationPaths = library("new-owner")
  const storage = openStorage(paths)
  const fixture = completeGraphFixtures()
  storage.sources.createInstallation({ id: "INSTALLATION-CANARY", ownerId: "owner-1" })
  const destination = {
    provider: "grok-subscription",
    accountId: "ACCOUNT-CANARY",
    workspaceId: "WORKSPACE-CANARY",
    installationId: "INSTALLATION-CANARY",
    connectionRevision: 1,
    billingRoute: "subscription-allowance",
  } as const
  const cacheInput = AnalysisCacheInput.parse({
    ...fixture.setup.analysis,
    editionHash: storage.sources.getEdition("edition-1")?.originalHash,
    provider: destination.provider,
    destination,
  })
  storage.sources.appendSetup({
    record: { ...fixture.setup, analysis: cacheInput },
    parentRevisionId: null,
  })
  storage.sources.appendGrant({
    ...fixture.grant,
    installationId: destination.installationId,
    destination,
  })
  storage.workflow.appendAnalysis({
    record: { ...fixture.analysis, cacheInput, cacheKey: analysisCacheKey(cacheInput) },
    parentRevisionId: null,
  })
  storage.subscriptionConnections.disconnect(destination.installationId, destination.provider)
  storage.close()
  // When
  const archive = captureLibrary(paths)
  restoreLibrary(destinationPaths, archive)
  // Then
  const text = archive.toString("utf8")
  for (const secret of [
    "INSTALLATION-CANARY",
    "ACCOUNT-CANARY",
    "WORKSPACE-CANARY",
    "subscription_connections",
  ])
    expect(text).not.toContain(secret)
  const restored = openStorage(destinationPaths)
  try {
    expect(restored.sources.getSetup(fixture.setup.id)?.analysis.provider).toBe("grok-subscription")
    expect(restored.sources.getGrant(fixture.grant.id)?.kind).toBe("historical")
    expect(
      restored.subscriptionConnections.revision("destination-installation", destination.provider),
    ).toBe(0)
  } finally {
    restored.close()
  }
})

it.each(["account", "workspace", "installation", "revision", "observations"] as const)(
  "keeps restored destinations distinct when only %s differs without restoring authority",
  (difference) => {
    // Given
    const paths = library("owner-1", true)
    const destinationPaths = library("new-owner")
    const storage = openStorage(paths)
    const fixture = completeGraphFixtures()
    const base = {
      provider: "grok-subscription",
      accountId: "ACCOUNT-A-CANARY",
      workspaceId: "WORKSPACE-A-CANARY",
      installationId: "INSTALLATION-A-CANARY",
      connectionRevision: 1,
      billingRoute: "subscription-provider-managed",
      executionPolicy: "tool-managed-v1",
      identityBinding: "local-generation-and-observations",
      observedAccount: {
        email: "OBSERVATION-A-CANARY",
        accountId: null,
        workspaceId: null,
        planType: "subscription",
      },
    } as const
    const changed = {
      ...base,
      accountId: difference === "account" ? "ACCOUNT-B-CANARY" : base.accountId,
      workspaceId: difference === "workspace" ? "WORKSPACE-B-CANARY" : base.workspaceId,
      installationId: difference === "installation" ? "INSTALLATION-B-CANARY" : base.installationId,
      connectionRevision: difference === "revision" ? 2 : base.connectionRevision,
      observedAccount: {
        ...base.observedAccount,
        email: difference === "observations" ? "OBSERVATION-B-CANARY" : base.observedAccount.email,
      },
    }
    const destinations = [base, changed]
    storage.sources.createInstallation({ id: base.installationId, ownerId: "owner-1" })
    if (changed.installationId !== base.installationId)
      storage.sources.createInstallation({ id: changed.installationId, ownerId: "owner-1" })
    storage.sources.createStudy({ id: "study-2", ownerId: "owner-1", editionId: "edition-1" })
    for (const [index, destination] of destinations.entries()) {
      const id = index + 1
      const cacheInput = AnalysisCacheInput.parse({
        ...fixture.setup.analysis,
        editionHash: storage.sources.getEdition("edition-1")?.originalHash,
        provider: destination.provider,
        destination,
      })
      const setup = storage.sources.appendSetup({
        record: {
          ...fixture.setup,
          id: `setup-${id}`,
          studyId: `study-${id}`,
          analysis: cacheInput,
        },
        parentRevisionId: null,
      })
      const grant = storage.sources.appendGrant({
        ...fixture.grant,
        id: `grant-${id}`,
        setupRevisionId: setup.id,
        installationId: destination.installationId,
        destination,
      })
      storage.workflow.appendAnalysis({
        record: {
          ...fixture.analysis,
          id: `analysis-${id}`,
          cacheInput,
          cacheKey: analysisCacheKey(cacheInput),
        },
        parentRevisionId: null,
      })
      const inputRevisionId = storage.workflow.ensureAnalysisInput(setup.id)
      storage.execution.appendRun({
        ...fixture.run,
        id: `run-${id}`,
        inputRevisionId,
        state: "running",
        reservedCalls: 0,
      })
      storage.execution.appendJob({
        ...fixture.job,
        id: `job-${id}`,
        runId: `run-${id}`,
        setupRevisionId: setup.id,
        provider: destination.provider,
        inputRevisionId,
        grant,
        state: "queued",
        stage: "analysis",
      })
    }
    storage.close()
    // When
    const archive = captureLibrary(paths)
    restoreLibrary(destinationPaths, archive)
    // Then
    for (const canary of [
      "ACCOUNT-A-CANARY",
      "ACCOUNT-B-CANARY",
      "WORKSPACE-A-CANARY",
      "WORKSPACE-B-CANARY",
      "INSTALLATION-A-CANARY",
      "INSTALLATION-B-CANARY",
      "subscription_connections",
      "OBSERVATION-A-CANARY",
      "OBSERVATION-B-CANARY",
    ])
      expect(archive.toString("utf8")).not.toContain(canary)
    const restored = openStorage(destinationPaths)
    try {
      const views = [1, 2].map((id) =>
        restored.revisions.current({ studyId: `study-${id}`, ownerId: "new-owner" }),
      )
      const keys = views.map((view) => analysisCacheKey(view.setup.analysis))
      expect(new Set(keys).size).toBe(2)
      expect(views.map((view) => view.analysis?.id)).toEqual(["analysis-1", "analysis-2"])
      for (const [index, view] of views.entries()) {
        const destination = view.setup.analysis.destination
        if (!destination) throw new TypeError("Missing restored destination")
        expect(destination.connectionRevision).not.toBe(
          restored.subscriptionConnections.revision(
            destination.installationId,
            destination.provider,
          ),
        )
        const grant = restored.sources.getGrant(`grant-${index + 1}`)
        expect(grant?.kind).toBe("historical")
        expect(
          TransmissionAuthorization.safeParse({
            setup: view.setup,
            grant,
            installationId: destination.installationId,
            ownerId: "new-owner",
            categories: ["book-text"],
          }).success,
        ).toBe(false)
        expect(restored.execution.getJob(`job-${index + 1}`)).toMatchObject({
          state: "paused",
          reason: "restored",
        })
      }
      expect(
        restored.execution.claimNextJob({
          token: "must-not-replay",
          now: "2026-10-19T00:00:00Z",
          expiresAt: "2026-10-19T00:10:00Z",
        }),
      ).toBeNull()
    } finally {
      restored.close()
    }
    expect(network).not.toHaveBeenCalled()
  },
)
