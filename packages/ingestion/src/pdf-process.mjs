import { runPdfWorker } from "./pdf/worker.ts"

await runPdfWorker(JSON.parse(process.argv[2]))
