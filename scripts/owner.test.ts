import { describe, expect, it } from "vitest"
import { assertInteractiveInvocation, OwnerCliUsageError } from "./owner.ts"

describe("owner CLI credential boundary", () => {
  it("refuses command-line arguments without reflecting their contents", () => {
    const privateValue = "password-that-must-never-be-logged"
    let capturedError: unknown

    try {
      assertInteractiveInvocation(["node", "scripts/owner.ts", privateValue], true, true)
    } catch (error: unknown) {
      if (!(error instanceof OwnerCliUsageError)) {
        throw error
      }
      capturedError = error
    }

    expect(capturedError).toBeInstanceOf(OwnerCliUsageError)
    if (capturedError instanceof OwnerCliUsageError) {
      expect(capturedError.message).not.toContain(privateValue)
    }
  })

  it("refuses credential input when either terminal stream is not a TTY", () => {
    expect(() => assertInteractiveInvocation(["node", "scripts/owner.ts"], false, true)).toThrow(
      OwnerCliUsageError,
    )
    expect(() => assertInteractiveInvocation(["node", "scripts/owner.ts"], true, false)).toThrow(
      OwnerCliUsageError,
    )
  })
})
