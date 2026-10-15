import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { z } from "zod"
import { workspaceRoot } from "./local-fixture.ts"

it("provides only an allowlisted pending operator-confirmation receipt", async () => {
  const document = await readFile(join(workspaceRoot, "docs/LOCAL.md"), "utf8")
  const template = /```json\n([\s\S]*?)\n```/.exec(document)?.[1]
  expect(template).toBeDefined()
  if (template === undefined) throw new TypeError("Operator receipt template missing")
  const receipt = z
    .strictObject({
      revision: z.string().min(1),
      confirmation_stage: z.literal("pending"),
      reset_status: z.literal("pending"),
      start_status: z.literal("pending"),
      login_status: z.literal("pending"),
      protected_status: z.literal("pending"),
    })
    .parse(JSON.parse(template))
  expect(receipt.confirmation_stage).toBe("pending")
})
