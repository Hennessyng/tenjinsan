import type { ProviderReceipt } from "@reading-studio/providers"
import { z } from "zod"

export function fixtureBatchReply(
  header: unknown,
  verdict: "supported" | "overstated",
): ProviderReceipt | null {
  const batch = z
    .object({
      kind: z.literal("batched-original-verification"),
      task: z.string(),
      interpretations: z.array(z.object({ id: z.string(), text: z.string() })),
    })
    .safeParse(header)
  if (!batch.success) return null
  return {
    kind: "output",
    usage: { kind: "known", inputTokens: 10, outputTokens: 10 },
    text: JSON.stringify({
      decisions: batch.data.interpretations.map((item) => ({
        id: item.id,
        verdict,
        explanation: "Authored synthetic verdict, not semantic truth",
      })),
      mapCoverage:
        batch.data.task === "map-omission"
          ? { verdict: "none", explanation: "Authored synthetic omission state", sources: [] }
          : null,
    }),
  }
}
