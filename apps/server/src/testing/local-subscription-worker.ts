import { randomUUID } from "node:crypto"
import { BookMapPipeline } from "@reading-studio/generation"
import { LocalSubscriptionAdapter, ProviderRunner } from "@reading-studio/providers"
import type { Storage } from "@reading-studio/storage"

export function localSubscriptionFixtureWorker(storage: Storage) {
  const tasks = new Set<Promise<void>>()
  const errors: string[] = []
  return {
    errors,
    enqueue(input: {
      readonly setupId: string
      readonly grantId: string
      readonly ownerId: string
      readonly installationId: string
    }) {
      const authority = {
        storage,
        ownerId: input.ownerId,
        installationId: input.installationId,
        localSubscriptions: true,
      }
      const pipeline = new BookMapPipeline(authority)
      pipeline.prepare(input.setupId, input.grantId)
      const task = (async () => {
        for (;;) {
          const job = storage.execution.claimNextJob({
            token: randomUUID(),
            now: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 120000).toISOString(),
          })
          if (!job) break
          if (job.state !== "running" || job.setupRevisionId !== input.setupId)
            throw new TypeError("Unexpected fixture job")
          const runner = new ProviderRunner({
            ...authority,
            clock: () => new Date(),
            adapters: { [job.provider]: new LocalSubscriptionAdapter(authority, job) },
          })
          await runner.execute(job, pipeline.stage(job))
        }
        pipeline.prepare(input.setupId, input.grantId)
      })()
        .catch((error: unknown) => {
          if (!(error instanceof Error)) throw error
          errors.push(error.name)
        })
        .finally(() => tasks.delete(task))
      tasks.add(task)
    },
    async settled() {
      await Promise.all(tasks)
    },
  }
}
