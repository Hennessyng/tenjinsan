import { afterEach, expect, it, vi } from "vitest"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { nativeScopeFixture } from "./full-book-native-scope-fixture.ts"

afterEach(() => vi.restoreAllMocks())
it.each([false, true])(
  "direct native runner refuses unapproved target (same-book new study=%s) before any charge or process",
  async (newStudy) => {
    // Given valid stored native consent and a compatible declared build, without a trusted release for this study.
    const f = nativeScopeFixture(newStudy)
    const session = vi.spyOn(f.storage.subscriptionLogin, "withSession")
    const claim = vi.spyOn(f.storage.fullBookExecution, "claim")
    try {
      // When run is called directly, neither API flags nor the stored review acknowledgement grants a release.
      const untrustedOptions = {
        signal: new AbortController().signal,
        now: () => clock.now,
        nativeEnabled: true,
        released: true,
        target: { studyId: "synthetic-unapproved-study", sourceCeiling: 1058 },
      }
      await expect(
        f.storage.fullBookManaged.run(f.grant.id, untrustedOptions),
      ).rejects.toMatchObject({ reason: "disabled" })
      // Then no lease, attempt, provider metadata lookup or source turn is issued.
      expect(claim).not.toHaveBeenCalled()
      expect(session).not.toHaveBeenCalled()
      expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(0)
      expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  },
)
