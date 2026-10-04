import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { z } from "zod"

const root = resolve(import.meta.dirname, "../..")
const environment = {
  ...process.env,
  CANONICAL_ORIGIN: "https://localhost",
  AUTH_SECRET: "hosted-test-secret-at-least-thirty-two-characters",
}
const serviceSchema = z.object({
  user: z.string().optional(),
  ports: z.array(z.object({ target: z.number() })).optional(),
  privileged: z.boolean().optional(),
  healthcheck: z.object({ test: z.array(z.string()) }),
  mem_limit: z.union([z.string(), z.number()]),
  pids_limit: z.number(),
})

describe("hosted deployment configuration", () => {
  it("exposes only the proxy when valid hosting settings are supplied", () => {
    // Given a canonical HTTPS origin and a private secret.
    // When Compose resolves the deployment.
    const result = spawnSync(
      "docker",
      ["compose", "-f", "deploy/compose.yml", "config", "--format", "json"],
      {
        cwd: root,
        env: environment,
        encoding: "utf8",
      },
    )
    // Then only the HTTPS proxy publishes ports and every service is bounded/healthy.
    expect(result.status, result.stderr).toBe(0)
    const config = z
      .object({ services: z.record(z.string(), serviceSchema) })
      .parse(JSON.parse(result.stdout))
    expect(Object.keys(config.services).sort()).toEqual(["api", "proxy", "worker"])
    for (const [name, service] of Object.entries(config.services)) {
      expect(service.user).toBe("1000:1000")
      expect(service.privileged ?? false).toBe(false)
      expect(service.pids_limit).toBeGreaterThan(0)
      if (name === "proxy")
        expect(service.ports?.map((port) => port.target).sort((a, b) => a - b)).toEqual([80, 443])
      else {
        expect(service.ports ?? []).toEqual([])
      }
    }
  })

  it.each(["CANONICAL_ORIGIN", "AUTH_SECRET"])("fails closed when %s is absent", (setting) => {
    // Given an empty required setting (overrides any ambient .env).
    // When Compose resolves the deployment.
    const result = spawnSync(
      "docker",
      ["compose", "-f", "deploy/compose.yml", "config", "--quiet"],
      {
        cwd: root,
        env: { ...environment, [setting]: "" },
        encoding: "utf8",
      },
    )
    // Then it cannot start an insecure deployment.
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(setting)
  })
})
