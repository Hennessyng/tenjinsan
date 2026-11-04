import { z } from "zod"
import { BatchedVerificationReserve, BatchedVerificationTarget } from "./batched-verification.ts"
import { chapterFindings, synthesisFindings } from "./book-map-findings.ts"
import { BookSynthesis, ChapterPartMap } from "./book-map-model.ts"
import { contentDigest } from "./identity.ts"
import { ContentId, Digest } from "./primitives.ts"

export const BatchedVerificationManifest = z
  .strictObject({
    reserve: BatchedVerificationReserve,
    maps: z.array(ChapterPartMap).readonly(),
    synthesis: BookSynthesis,
    batches: z
      .array(
        z
          .strictObject({ hash: Digest, findingIds: z.array(ContentId).min(1).readonly() })
          .readonly(),
      )
      .min(1)
      .readonly(),
    targets: z.array(BatchedVerificationTarget).min(1).readonly(),
  })
  .superRefine((value, ctx) => {
    const fail = () =>
      ctx.addIssue({ code: "custom", message: "incomplete or foreign verification matrix" })
    const plan = value.reserve,
      windows = plan.windowHashes,
      global = synthesisFindings(value.synthesis)
    if (
      value.maps.length !== windows.length ||
      value.maps.some((map) => !map.complete) ||
      !value.synthesis.complete ||
      new Set(value.maps.map((map) => map.partId)).size !== value.maps.length ||
      value.batches.length > plan.maxFindingBatches ||
      new Set(value.batches.map((batch) => batch.hash)).size !== value.batches.length ||
      JSON.stringify(value.batches.flatMap((batch) => batch.findingIds)) !==
        JSON.stringify(global.map((finding) => finding.id))
    )
      fail()
    const keys = new Set(windows.map((window) => `map-omission:${window}:`))
    const order = [...keys]
    for (const batch of value.batches) {
      const selected = batch.findingIds.map((id) => global.find((finding) => finding.id === id))
      if (
        selected.some((finding) => !finding) ||
        contentDigest(JSON.stringify(selected)) !== batch.hash
      )
        fail()
      keys.add(`synthesis-citations::${batch.hash}`)
      for (const window of windows) {
        keys.add(`window-findings:${window}:${batch.hash}`)
        order.push(`window-findings:${window}:${batch.hash}`)
      }
      order.push(`synthesis-citations::${batch.hash}`)
    }
    if (
      value.targets.length !== keys.size ||
      value.targets.length > plan.maxVerificationJobs ||
      new Set(value.targets.map((target) => target.id)).size !== value.targets.length
    )
      fail()
    for (const target of value.targets) {
      const key = `${target.kind}:${target.windowHash ?? ""}:${target.batchHash ?? ""}`
      if (
        !keys.delete(key) ||
        target.planId !== plan.id ||
        target.mapsHash !== contentDigest(JSON.stringify(value.maps)) ||
        target.synthesisHash !== contentDigest(JSON.stringify(value.synthesis)) ||
        target.sourceHash !== contentDigest(JSON.stringify(target.originals))
      )
        fail()
      const index = windows.indexOf(target.windowHash ?? plan.id)
      if (
        target.kind !== "synthesis-citations" &&
        (index < 0 || target.windowHash !== target.sourceHash)
      )
        fail()
      if (target.kind === "map-omission") {
        const map = value.maps[index]
        if (
          !map ||
          JSON.stringify(target.findingIds) !==
            JSON.stringify(chapterFindings(map).map((finding) => finding.id)) ||
          target.findingsHash !== contentDigest(JSON.stringify(chapterFindings(map)))
        )
          fail()
      } else {
        const batch = value.batches.find((batch) => batch.hash === target.batchHash)
        if (
          !batch ||
          JSON.stringify(target.findingIds) !== JSON.stringify(batch.findingIds) ||
          target.findingsHash !== batch.hash
        )
          fail()
      }
    }
    if (keys.size > 0) fail()
    if (
      JSON.stringify(
        value.targets.map(
          (target) => `${target.kind}:${target.windowHash ?? ""}:${target.batchHash ?? ""}`,
        ),
      ) !== JSON.stringify(order)
    )
      fail()
  })
  .readonly()
export type BatchedVerificationManifest = z.infer<typeof BatchedVerificationManifest>
