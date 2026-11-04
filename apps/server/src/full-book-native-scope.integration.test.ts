import { randomUUID } from "node:crypto"
import {
  contentDigest,
  FullBookManagedConsent,
  FullBookManagedPolicy,
  PINNED_CODEX_BUILD,
} from "@reading-studio/contracts"
import { expect, it, vi } from "vitest"
import { FullBookLifecycle } from "./full-book-lifecycle.ts"
import { fullBookConsentInput, fullBookServerFixture } from "./testing/full-book-run-fixture.ts"

it("ordinary server lifecycle cannot dispatch a build-pinned study without its exact trusted scope", async () => {
  // Given normal admission followed by a valid native consent, not a trusted scoped release.
  const f = fullBookServerFixture()
  const lifecycle = new FullBookLifecycle(f.storage, undefined)
  const run = vi.spyOn(f.storage.fullBookManaged, "run")
  const recover = vi.spyOn(f.storage.fullBookExecution, "recover")
  try {
    const input = await fullBookConsentInput(f)
    expect((await f.post("consent", input)).status).toBe(201)
    const pair = f.storage.fullBookManagedConsents.read(input.submissionId)
    const policy = FullBookManagedPolicy.parse({
      ...pair.grant.policy,
      build: {
        kind: "pinned-codex",
        binaryPath: pair.grant.policy.build.binaryPath,
        ...PINNED_CODEX_BUILD,
      },
    })
    const grant = FullBookManagedConsent.parse({
      ...pair.grant,
      id: randomUUID(),
      policy,
      reviewAcknowledgement: {
        ...pair.grant.reviewAcknowledgement,
        runtimeBinding: contentDigest(JSON.stringify(policy)),
      },
    })
    f.storage.fullBookManagedConsents.approve(grant)
    const scope = { id: grant.id, owner: pair.budget.ownerId, setupId: pair.budget.setupRevisionId }
    // When/Then a build pin cannot open native dispatch, recovery or a charge in an ordinary server.
    expect(lifecycle.state(scope)).toMatchObject({ canResume: false, native: { enabled: false } })
    await expect(lifecycle.resume(scope)).rejects.toMatchObject({ reason: "disabled" })
    expect(run).not.toHaveBeenCalled()
    expect(recover).not.toHaveBeenCalled()
    expect(f.storage.fullBookExecution.attempts(pair.budget.id)).toHaveLength(0)
  } finally {
    vi.restoreAllMocks()
    f.cleanup()
  }
})
