import { LocalSubscriptionSession } from "@reading-studio/contracts"
import { BookMapPipeline } from "@reading-studio/generation"
import { openStorage } from "@reading-studio/storage"
import { z } from "zod"

const send = process.send?.bind(process)
if (!send) throw new TypeError("Synthetic edge process requires IPC")
process.once("message", (raw: unknown) => {
  const input = z
    .object({
      options: z.object({ databasePath: z.string(), privateDataRoot: z.string() }),
      operation: z.enum(["prepare", "reserve"]),
      setupId: z.string(),
      grantId: z.string(),
      capacity: z.object({
        id: z.string(),
        provider: z.literal("chatgpt-subscription"),
        model: z.string(),
        destination: z.object({}).passthrough(),
        contextTokens: z.number(),
        maxOutputTokens: z.number(),
        maxRequestBytes: z.number(),
        evidence: z.string(),
      }),
      lease: z
        .object({ jobId: z.string(), token: z.string(), fence: z.number(), now: z.string() })
        .optional(),
      attemptId: z.string(),
      session: LocalSubscriptionSession,
      target: z.unknown().optional(),
    })
    .parse(raw)
  const storage = openStorage({
    ...input.options,
    ...(input.target ? { liveStudyTarget: input.target } : {}),
  })
  storage.subscriptionLogin.status = () => input.session
  storage.subscriptionLogin.canDispatch = () => true
  process.once("message", () => {
    try {
      if (input.operation === "reserve") {
        if (!input.lease) throw new TypeError("Missing synthetic lease")
        send(
          storage.execution.reserveAttempt({
            ...input.lease,
            attemptId: input.attemptId,
            preparedAt: input.lease.now,
          }).kind,
        )
      } else {
        const setup = storage.sources.getSetup(input.setupId)
        if (!setup?.analysis.destination) throw new TypeError("Missing synthetic destination")
        const pipeline = new BookMapPipeline({
          storage,
          ownerId: "owner-1",
          installationId: "installation-1",
          localSubscriptions: true,
          capacity: {
            ...input.capacity,
            evidenceScope: {
              kind: "synthetic-offline",
              measurement: "legacy-tool-input-pad-1",
              downstream: "unverified",
            },
            destination: setup.analysis.destination,
            countInputTokens: (request) =>
              Buffer.byteLength(JSON.stringify([request.prompt, request.schema]), "utf8"),
          },
        })
        const value = pipeline.prepare(input.setupId, input.grantId)
        send({ phase: value.wholeBook?.phase, hash: value.wholeBook?.batched?.manifestHash })
      }
    } catch (error) {
      send({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      storage.close()
      process.disconnect?.()
    }
  })
  send("ready")
})
