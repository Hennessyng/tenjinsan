import { execFileSync } from "node:child_process"
import { LessonRevision } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { z } from "zod"

it("generates a stored bilingual lesson through the fixture CLI and rejects pending approval", () => {
  // Given
  const script = new URL("../scripts/lesson-fixture.ts", import.meta.url)
  // When
  const output = execFileSync(
    process.execPath,
    ["--experimental-transform-types", script.pathname],
    { encoding: "utf8" },
  )
  // Then
  const result = z
    .strictObject({
      provider: z.literal("fixture"),
      pendingRejected: z.literal(true),
      lesson: LessonRevision,
    })
    .parse(JSON.parse(output))
  expect(result.lesson.sections).toHaveLength(1)
  expect(result.lesson.sections[0]?.teaching?.blocks).toHaveLength(4)
})
