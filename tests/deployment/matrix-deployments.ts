import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { Browser, BrowserContext } from "@playwright/test"
import { z } from "zod"
import { provisionComposeMatrixOwner } from "./matrix-compose-owner.ts"
import type { MatrixDeployment } from "./matrix-driver.ts"
import { proxyToPort } from "./matrix-proxy.ts"
import { restoreComposeMatrix } from "./matrix-restore-compose.ts"
import { MatrixSnapshot } from "./matrix-snapshot.ts"

export { startLocalMatrix } from "./matrix-local.ts"

export type RunningMatrix = {
  readonly deployment: MatrixDeployment
  readonly stop: () => Promise<void>
}

export async function startComposeMatrix(browser: Browser): Promise<RunningMatrix> {
  const project = `matrix-${randomUUID().slice(0, 8)}`
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CANONICAL_ORIGIN: "https://localhost",
    AUTH_SECRET: "matrix-compose-secret-at-least-32-characters",
    PROXY_BIND: "127.0.0.1",
    HTTP_PORT: "0",
    HTTPS_PORT: "0",
    OPENROUTER_API_KEY: "wire-only-test-credential",
    ANTHROPIC_API_KEY: "wire-only-test-credential",
  }
  delete environment["STUDIO_SYNTHETIC_TEST_MODE"]
  const prefix = [
    "compose",
    "-p",
    project,
    "-f",
    "deploy/compose.yml",
    "-f",
    "tests/deployment/compose-wire.yml",
    "-f",
    "tests/deployment/compose-matrix.yml",
  ]
  const compose = (args: readonly string[]) =>
    execFileSync("docker", [...prefix, ...args], {
      encoding: "utf8",
      env: environment,
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
    }).trim()
  let proxy: Awaited<ReturnType<typeof proxyToPort>> | undefined
  let context: BrowserContext | undefined
  const cleanup = async () => {
    await context?.close()
    await proxy?.close()
    compose(["down", "--volumes", "--remove-orphans"])
  }
  try {
    compose(["build"])
    provisionComposeMatrixOwner(prefix, environment, false)
    compose(["up", "-d", "--wait", "--wait-timeout", "120"])
    for (const role of ["api", "worker"]) {
      compose([
        "exec",
        "-T",
        role,
        "node",
        "-e",
        "if ('STUDIO_SYNTHETIC_TEST_MODE' in process.env) process.exit(2)",
      ])
    }
    const binding = compose(["port", "proxy", "443"])
    const port = Number(binding.split(":").at(-1))
    if (!Number.isInteger(port)) throw new TypeError("Hosted proxy binding unavailable")
    proxy = await proxyToPort(port)
    context = await browser.newContext({
      proxy: { server: proxy.url },
      ignoreHTTPSErrors: true,
    })
    const page = await context.newPage()
    return {
      deployment: {
        origin: "https://localhost",
        page,
        snapshot: async (setupId) =>
          MatrixSnapshot.parse(
            JSON.parse(
              compose([
                "exec",
                "-T",
                "api",
                "node",
                "--experimental-transform-types",
                "tests/deployment/matrix-snapshot.ts",
                ...(setupId ? [setupId] : []),
              ]),
            ),
          ),
        fault: async (fault) => {
          compose([
            "exec",
            "-T",
            "api",
            "node",
            "-e",
            "require('node:fs').writeFileSync('/data/matrix-wire-fault', process.argv[1])",
            fault,
          ])
        },
        renderFailure: async (enabled) => {
          compose([
            "exec",
            "-T",
            "api",
            "node",
            "-e",
            enabled
              ? "require('node:fs').writeFileSync('/data/matrix-render-failure', 'enabled')"
              : "require('node:fs').rmSync('/data/matrix-render-failure', { force: true })",
          ])
          const workerEnabled = compose([
            "exec",
            "-T",
            "worker",
            "node",
            "-e",
            "process.stdout.write(String(process.env.STUDIO_MATRIX_RENDER_FAILURE === 'enabled' && require('node:fs').existsSync('/data/matrix-render-failure')))",
          ])
          if ((workerEnabled === "true") !== enabled)
            throw new TypeError("Renderer fault switch did not reach the worker volume")
        },
        transfer: async (targets) => restoreComposeMatrix(browser, project, environment, targets),
        wireCount: async () =>
          Number(
            compose([
              "exec",
              "-T",
              "api",
              "node",
              "-e",
              "process.stdout.write(require('node:fs').readFileSync('/data/production-wire-count', 'utf8'))",
            ]),
          ),
        heldCount: async () =>
          z
            .array(z.object({ fault: z.string().optional() }))
            .parse(
              JSON.parse(
                compose([
                  "exec",
                  "-T",
                  "api",
                  "node",
                  "-e",
                  "process.stdout.write(require('node:fs').readFileSync('/data/production-wire-metrics', 'utf8'))",
                ]),
              ),
            )
            .filter((metric) => metric.fault === "hold").length,
        releaseHeld: async () => {
          compose([
            "exec",
            "-T",
            "api",
            "node",
            "-e",
            "require('node:fs').writeFileSync('/data/matrix-wire-release', require('node:crypto').randomUUID())",
          ])
        },
        rememberLease: async (jobId) => {
          compose([
            "exec",
            "-T",
            "api",
            "node",
            "--experimental-transform-types",
            "tests/deployment/matrix-stale-commit.ts",
            "capture",
            jobId,
          ])
        },
        rejectStaleCommit: async (jobId) =>
          z
            .object({ rejected: z.boolean() })
            .parse(
              JSON.parse(
                compose([
                  "exec",
                  "-T",
                  "api",
                  "node",
                  "--experimental-transform-types",
                  "tests/deployment/matrix-stale-commit.ts",
                  "probe",
                  jobId,
                ]),
              ),
            ).rejected,
        restartWorker: async (setupId, jobId) => {
          compose(["kill", "-s", "SIGKILL", "worker"])
          compose(["stop", "worker"])
          const snapshot = MatrixSnapshot.parse(
            JSON.parse(
              compose([
                "exec",
                "-T",
                "api",
                "node",
                "--experimental-transform-types",
                "tests/deployment/matrix-snapshot.ts",
                setupId,
              ]),
            ),
          )
          const job = snapshot.setup?.jobs.find(
            (item) => item.id === jobId && item.state === "running",
          )
          if (!job) throw new TypeError("Missing running job to expire")
          compose([
            "exec",
            "-T",
            "api",
            "node",
            "-e",
            "const db = new (require('node:sqlite').DatabaseSync)('/data/studio.sqlite'); db.prepare(\"UPDATE jobs SET lease_expires_at = ? WHERE id = ? AND state = 'running'\").run('2000-01-01T00:00:00.000Z', process.argv[1]); db.close()",
            job.id,
          ])
          compose(["start", "worker"])
        },
      },
      stop: cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}
