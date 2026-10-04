import { readFile } from "node:fs/promises"
import { expect, it } from "vitest"
import { z } from "zod"

const ManualReceipt = z.object({
  candidate_head: z.string(),
  observations: z.array(z.string()),
  screen_reader: z
    .object({
      browser: z.string().min(1),
      assistive_technology: z.string().min(1),
      observations: z.array(z.string().min(1)).min(1),
    })
    .optional(),
})

it("TEN-13 AC3 requires observed screen-reader proof before conformance can be complete", async () => {
  const receipt = ManualReceipt.parse(
    JSON.parse(
      await readFile(
        new URL(
          "../../.sisyphus/runs/ten-13-keep-workspace-interaction-accessible/evidence/manual-observations.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  )
  expect(
    receipt.screen_reader,
    "AA_PROOF_MISSING: genuine current-release Chromium screen-reader reading and announcement observations are unavailable; limited focus observations and S12 screenshots cannot establish whole-workspace WCAG 2.2 AA.",
  ).toBeDefined()
})
