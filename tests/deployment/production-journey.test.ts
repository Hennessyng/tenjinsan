import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { expect, it } from "vitest"
import { z } from "zod"

const run = promisify(execFile)

it("ordinary API and worker publish a bilingual study without a synthetic-mode flag", async () => {
  const environment = { ...process.env }
  delete environment["STUDIO_SYNTHETIC_TEST_MODE"]
  const { stdout } = await run(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--experimental-transform-types",
      "tests/deployment/production-manual-qa.ts",
    ],
    { env: environment, timeout: 90_000 },
  )
  const result = z
    .object({
      mode: z.literal("normal"),
      intake: z.literal(202),
      grant: z.literal(200),
      analysis: z.literal("successful"),
      edition: z.number().int().positive(),
      questionOptions: z.number().int().min(2),
      brief: z.literal("approved"),
      customAnswer: z.literal("custom"),
      outline: z.literal("approved"),
      lesson: z.string().min(1),
      publication: z.string().min(1),
      artifactBytes: z.object({
        html: z.number().int().positive(),
        pdf: z.number().int().positive(),
      }),
      artifactHashes: z.object({ html: z.string().length(64), pdf: z.string().length(64) }),
      providerWireCalls: z.number().int().positive(),
      providerRequestBytes: z.array(z.number().int().positive()),
      lessonSectionOrder: z.array(z.string()).min(1),
    })
    .parse(JSON.parse(stdout.trim()))
  expect(result.providerWireCalls).toBe(7)
  expect(result.providerRequestBytes).toHaveLength(result.providerWireCalls)
  expect(Math.max(...result.providerRequestBytes)).toBeLessThanOrEqual(32_000)
}, 90_000)
