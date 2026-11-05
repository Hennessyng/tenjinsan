import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { defaultSettings } from "../src/catalog.ts"
import { dispatchLocalCodex } from "../src/local-codex-dispatch.ts"
import { localRequestBinding } from "../src/local-tool-request.ts"
import { structuredRequest } from "../src/structured-request.ts"
import { closeCodexFixtures, given } from "./local-codex-event-fixture.ts"

afterEach(closeCodexFixtures)
it("rejects a duplicate prepared frame without losing the first request's response", async () => {
  const { session } = await given({ items: [] })
  const frame = session.rpc.prepareRequest("mcpServerStatus/list", {})
  const first = session.rpc.requestPrepared(frame, 1000)
  await expect(session.rpc.requestPrepared(frame, 1000)).rejects.toThrow("invalid-frame")
  await expect(first).resolves.toEqual({ data: [], nextCursor: null })
})
it("refuses one-byte combined frame overflow without writing another inference turn", async () => {
  const fixture = await given({ items: [{ text: '{"answer":"final"}', phase: "final_answer" }] })
  const first = await dispatchLocalCodex(fixture.session, fixture.request, () => undefined)
  if (!first.appWire) throw new TypeError("Missing measured app frames")
  const before = (await readFile(fixture.capture, "utf8")).trimEnd().split("\n").length
  await expect(
    dispatchLocalCodex(fixture.session, fixture.request, {
      authorize: () => undefined,
      binding: "a".repeat(64),
      maxFrameBytes: first.appWire.bytes - 1,
    }),
  ).rejects.toThrow("input-limit")
  const subsequent = (await readFile(fixture.capture, "utf8"))
    .trimEnd()
    .split("\n")
    .slice(before)
    .map((line) => z.object({ method: z.string() }).parse(JSON.parse(line)).method)
  expect(subsequent).toEqual(["mcpServerStatus/list", "thread/start"])
})
it.each([false, true])(
  "binds exact captured normal and repair frames with optional-schema mode=%s",
  async (optional) => {
    const fixture = await given({ items: [{ text: '{"answer":"final"}', phase: "final_answer" }] })
    const schema = z.toJSONSchema(
      z.strictObject({ answer: z.string(), ...(optional ? { note: z.string().optional() } : {}) }),
    )
    const route = {
      setupId: "setup",
      grantId: "grant",
      jobId: "job",
      capacityId: "synthetic",
      destination: { accountId: "fixture-A", workspace: null },
    }
    for (const repair of [
      undefined,
      { format: "json-only" as const, issues: [{ code: "invalid-json" as const, path: [] }] },
    ]) {
      const request = structuredRequest({
        model: "synthetic-model",
        settings: defaultSettings,
        instruction: '早🧭\n\t\\"',
        blocks: [{ text: 'é\\\n"' }],
        schema,
        signal: AbortSignal.timeout(5000),
        ...(repair ? { schemaRepair: repair } : {}),
      })
      const binding = localRequestBinding(request, route)
      const result = await dispatchLocalCodex(fixture.session, request, {
        authorize: () => undefined,
        binding,
        maxFrameBytes: 32000,
      })
      const written = (await readFile(fixture.capture, "utf8"))
        .trimEnd()
        .split("\n")
        .slice(-2)
        .map((line) => Buffer.from(`${line}\n`, "utf8"))
      expect(
        result.appWire?.frames.map((frame) => ({
          bytes: frame.bytes,
          sha256: frame.sha256,
          binding: frame.binding,
        })),
      ).toEqual(
        written.map((bytes) => ({
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          binding,
        })),
      )
      expect(result.appWire?.bytes).toBe(written.reduce((sum, bytes) => sum + bytes.length, 0))
      expect(result.appWire?.downstreamInput).toBe("unmeasured")
      expect(
        localRequestBinding(request, {
          ...route,
          destination: { accountId: "fixture-B", workspace: null },
        }),
      ).not.toBe(binding)
    }
  },
)
