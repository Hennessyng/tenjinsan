import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { expect, test } from "vitest"

test("hosted preflight accepts one HTTPS origin without auth settings or opening data", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-transform-types",
      resolve(import.meta.dirname, "hosted-config.ts"),
    ],
    {
      encoding: "utf8",
      env: {
        HOSTED_ROLE: "api",
        DATABASE_PATH: "/synthetic/not-opened.sqlite",
        SERVER_HOST: "0.0.0.0",
        SERVER_PORT: "8787",
        TRUSTED_ORIGINS: "https://library.example",
        TRUST_PROXY: "1",
      },
      timeout: 5000,
    },
  )
  expect(result.status).toBe(0)
  expect(result.stdout).toBe("")
  expect(result.stderr).toBe("")
})
