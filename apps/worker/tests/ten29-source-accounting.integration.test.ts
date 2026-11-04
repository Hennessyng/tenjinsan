import { NormalizationRevision } from "@reading-studio/contracts"
import { completeGraphFixtures } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { managedWorkflowFixture } from "./managed-workflow-fixture.ts"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it.each([
  { name: "escaped ASCII", text: "\\".repeat(40000) },
  { name: "UTF-8", text: "早🧭".repeat(7000) },
])(
  "accounts for $name reviewed input under the room policy without slicing source",
  async ({ name, text }) => {
    const document = NormalizationRevision.parse({
      ...completeGraphFixtures().normalization,
      coverage: "complete",
      omissions: [],
      resources: [
        {
          path: "pdf/page-1",
          role: "main-chapter",
          status: "included",
          blocks: [{ id: "early", text, locator: { kind: "pdf", page: 1 } }],
        },
        {
          path: "pdf/page-3",
          role: "supplementary",
          status: "included",
          blocks: [{ id: "final", text: "Final", locator: { kind: "pdf", page: 3 } }],
        },
      ],
    })
    const flow = await managedWorkflowFixture({ document, allowSendRefusal: true })
    try {
      if (name === "UTF-8") {
        expect(text.length).toBeLessThan(32000)
        expect(Buffer.byteLength(text, "utf8")).toBeGreaterThan(32000)
      }
      const before = flow.storage.sources.getNormalization(document.id)
      if (name === "UTF-8") {
        expect(flow.sent.status).toBe(200)
        expect(flow.storage.sources.getGrant(flow.grantId)?.kind).toBe("active")
        const plan = flow.storage.sources.getSetup(flow.setupId)?.analysis.processing?.plan
        if (!plan || !before) throw new TypeError("Missing complete signed source plan")
        const ranges = plan.flatMap((part) => part.ranges)
        for (const resource of before.resources)
          if (resource.status === "included")
            for (const block of resource.blocks)
              expect(
                ranges
                  .filter(
                    (range) => range.resourcePath === resource.path && range.blockId === block.id,
                  )
                  .map((range) => block.text.slice(range.start, range.end))
                  .join(""),
              ).toBe(block.text)
        expect(flow.storage.counts().jobs).toBeGreaterThan(1)
      } else {
        expect(flow.sent.status).toBe(422)
        expect(await flow.sent.json()).toMatchObject({
          error: "scope-limit",
          coverage: { reason: "attempt-budget-limit", transmission: "not-sent" },
        })
        const review = await flow.app.request(
          `http://127.0.0.1:8787/api/study-setup/${flow.normalizationId}/${flow.setupId}`,
        )
        expect(await review.json()).toMatchObject({
          preparation: { state: "blocked", reason: "attempt-budget-limit" },
        })
        expect(flow.storage.counts()).toMatchObject({ grants: 0, jobs: 0, attempts: 0 })
      }
      expect(await flow.requests()).toEqual([])
      expect(flow.storage.counts().attempts).toBe(0)
      expect(flow.storage.sources.getNormalization(document.id)).toEqual(before)
      expect(flow.network).not.toHaveBeenCalled()
    } finally {
      await flow.close()
    }
  },
)
