import { defineConfig } from "vitest/config"
import { repoRoot } from "../acceptance/ten29/evidence.ts"

export default defineConfig({
  root: repoRoot,
  envDir: false,
  test: {
    include: ["tests/diagnostics/ten29-pdf-provenance.diagnostic.ts"],
    maxWorkers: 1,
    fileParallelism: false,
  },
})
