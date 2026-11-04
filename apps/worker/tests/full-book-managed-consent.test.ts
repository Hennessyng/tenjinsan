import { randomUUID } from "node:crypto"
import { expect, it } from "vitest"
import { managedFixture } from "./full-book-managed-fixture.ts"

it("requires a distinct persisted full-book native authorization bound to its immutable source-budget manifest", () => {
  // Given only the existing source-budget manifest, which grants no native entry by itself.
  const f = managedFixture()
  try {
    expect(() => f.storage.fullBookManagedConsents.read(f.budget.id)).toThrow()
    // When a distinct exact-policy authorization is recorded.
    f.storage.fullBookManagedConsents.approve(f.grant)
    // Then the selected account/model/settings/limits/omissions are bound through the immutable budget hash.
    expect(f.storage.fullBookManagedConsents.read(f.grant.id).budget).toEqual(f.budget)
  } finally {
    f.cleanup()
  }
})

it.each(["binding", "warnings", "missing-budget"])(
  "refuses %s native authority without a fallback grant",
  (damage) => {
    // Given a native authorization with one independently invalid boundary.
    const f = managedFixture()
    try {
      const value =
        damage === "binding"
          ? { ...f.grant, budgetBinding: "f".repeat(64) }
          : damage === "warnings"
            ? { ...f.grant, warningsAcknowledged: false }
            : { ...f.grant, budgetConsentId: randomUUID() }
      // When/Then an ordinary/fake grant cannot become native authority through mismatched input.
      expect(() => f.storage.fullBookManagedConsents.approve(value)).toThrow()
      expect(() => f.storage.fullBookManagedConsents.read(f.grant.id)).toThrow()
    } finally {
      f.cleanup()
    }
  },
)
