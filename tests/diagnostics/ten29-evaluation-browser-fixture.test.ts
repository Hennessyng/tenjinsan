import { expect, it } from "vitest"
import { completedEvaluationBrowserFixture } from "./ten29-evaluation-browser-fixture.ts"

it("completes and serves the real guarded synthetic analysis before closing its owned server", async () => {
  const fixture = await completedEvaluationBrowserFixture()
  try {
    expect(fixture.evidence.saved).toMatchObject({
      terminal: "verified-analysis",
      canResume: false,
    })
    expect(fixture.evidence.nativeTurns).toBe(5)
  } finally {
    await fixture.harness.close()
  }
}, 15000)
