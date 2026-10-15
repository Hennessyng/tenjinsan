import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  envDir: false,
  test: {
    exclude: [...configDefaults.exclude, ".omo/**", ".sisyphus/**"],
    maxWorkers: 1,
    fileParallelism: false,
  },
})
