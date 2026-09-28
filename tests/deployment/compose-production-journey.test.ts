import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { expect, it } from "vitest"
import { z } from "zod"

const execute = promisify(execFile)

it("runs the ordinary API and worker in Compose through a loopback wire to released HTML and PDF", async () => {
  const project = `normal-wire-${randomUUID().slice(0, 8)}`
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CANONICAL_ORIGIN: "https://localhost",
    AUTH_SECRET: "compose-normal-wire-secret-at-least-32-characters",
    PROXY_BIND: "127.0.0.1",
    HTTP_PORT: "0",
    HTTPS_PORT: "0",
    OPENAI_API_KEY: "wire-only-test-credential",
    ANTHROPIC_API_KEY: "",
  }
  delete environment["STUDIO_SYNTHETIC_TEST_MODE"]
  const command = [
    "compose",
    "-p",
    project,
    "-f",
    "deploy/compose.yml",
    "-f",
    "tests/deployment/compose-wire.yml",
  ]
  const run = (args: readonly string[]) =>
    execute("docker", [...command, ...args], {
      env: environment,
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
    })
  try {
    await run(["build"])
    await run([
      "run",
      "--rm",
      "--no-deps",
      "-e",
      "OWNER_EMAIL=owner@example.test",
      "-e",
      "OWNER_NAME=Hosted Owner",
      "-e",
      "OWNER_PASSWORD=correct horse battery staple",
      "api",
      "node",
      "--experimental-transform-types",
      "apps/server/src/testing/provision-owner-fixture.ts",
    ])
    await run(["up", "-d", "--wait", "--wait-timeout", "120"])
    for (const role of ["api", "worker"]) {
      await run([
        "exec",
        "-T",
        role,
        "node",
        "-e",
        "if ('STUDIO_SYNTHETIC_TEST_MODE' in process.env) process.exit(2)",
      ])
    }
    await run(["exec", "-T", "worker", "test", "-f", "/data/production-wire-count"])
    const { stdout } = await run([
      "exec",
      "-T",
      "-e",
      "STUDIO_COMPOSE_TEST_MODE=enabled",
      "api",
      "node",
      "--experimental-transform-types",
      "tests/deployment/production-manual-qa.ts",
    ])
    const result = z
      .object({
        mode: z.literal("normal"),
        providerWireCalls: z.literal(7),
        providerRequestBytes: z.array(z.number().int().positive()),
        lessonSectionOrder: z.array(z.string()).min(1),
        artifactBytes: z.object({ html: z.number().positive(), pdf: z.number().positive() }),
        publication: z.string().min(1),
      })
      .parse(JSON.parse(stdout.trim()))
    expect(result.artifactBytes.html).toBeGreaterThan(100)
    expect(result.artifactBytes.pdf).toBeGreaterThan(100)
    expect(result.providerRequestBytes).toHaveLength(result.providerWireCalls)
    expect(Math.max(...result.providerRequestBytes)).toBeLessThanOrEqual(32_000)
    process.stdout.write(`${JSON.stringify({ event: "normal-compose", ...result })}\n`)
  } finally {
    await run(["down", "--volumes", "--remove-orphans"])
  }
}, 600_000)
