import { pathToFileURL } from "node:url"

export * from "./runtime.ts"

export const workerBootstrap = {
  acceptsJobs: true,
  mode: "persisted-jobs",
} as const

export async function runWorkerProcess(): Promise<void> {
  process.stdout.write(`Reading studio worker ready: ${JSON.stringify(workerBootstrap)}\n`)
  if (process.env["STUDIO_SYNTHETIC_TEST_MODE"] === "enabled") {
    const controller = new AbortController()
    const stop = (): void => controller.abort()
    process.once("SIGINT", stop)
    process.once("SIGTERM", stop)
    try {
      const { runSyntheticWorker } = await import("./testing/synthetic-runtime.ts")
      await runSyntheticWorker(controller.signal)
    } finally {
      process.off("SIGINT", stop)
      process.off("SIGTERM", stop)
    }
    return
  }
  const controller = new AbortController()
  const stop = (): void => controller.abort()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  try {
    const { runProductionWorker } = await import("./production-runtime.ts")
    await runProductionWorker(controller.signal)
  } finally {
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
  }
  process.stdout.write("Reading studio worker stopped.\n")
}

const executablePath = process.argv[1]
if (executablePath !== undefined && import.meta.url === pathToFileURL(executablePath).href) {
  await runWorkerProcess()
}
