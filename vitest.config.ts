import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, ".omo/worktrees/**", ".sisyphus/worktrees/**"],
    maxWorkers: 1,
    fileParallelism: false,
  },
})
