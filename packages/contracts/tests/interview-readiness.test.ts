import { expect, it } from "vitest"
import { InterviewReadiness } from "../src/interview.ts"

it.each(["//other.invalid", "/\\other.invalid"])(
  "rejects a browser-normalized external action %s",
  (actionHref) => {
    // Given
    const response = { kind: "setup-required", actionHref }
    // When
    const parsed = InterviewReadiness.safeParse(response)
    // Then
    expect(parsed.success).toBe(false)
  },
)
