import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { connect, type Socket } from "node:net"
import { resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { chromium, expect, test } from "@playwright/test"
import { Task31Records } from "@reading-studio/server/task31-records"
import { runDeployedJourney, verifyDeployedOffline } from "./deployed-journey.ts"
import { assertSavedManifest, verifyDeployedEvidence } from "./verify-deployed-evidence.ts"

const root = resolve(import.meta.dirname, "../..")
const evidence = ".omo/evidence/reading-studio/task-31/deployed-compose"
const environment = {
  ...process.env,
  CANONICAL_ORIGIN: "https://localhost",
  AUTH_SECRET: "task31-compose-secret-at-least-thirty-two-characters",
  PROXY_BIND: "127.0.0.1",
  HTTP_PORT: "0",
  HTTPS_PORT: "0",
}
let activeProject: string | undefined

test.afterEach(() => {
  if (!activeProject) return
  execFileSync(
    "docker",
    [
      "compose",
      "-p",
      activeProject,
      "-f",
      "deploy/compose.yml",
      "-f",
      "tests/deployment/compose-synthetic.yml",
      "down",
      "--volumes",
      "--remove-orphans",
    ],
    { cwd: root, env: environment, timeout: 60_000, stdio: "pipe" },
  )
  activeProject = undefined
})

async function proxyToPort(port: number): Promise<{ stop: () => Promise<void>; url: string }> {
  const sockets = new Set<Socket>()
  const server = createServer()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  server.on("connect", (request, client, head) => {
    if (request.url !== "localhost:443") {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n")
      return
    }
    const upstream = connect(port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length > 0) upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
    })
    sockets.add(upstream)
    upstream.on("close", () => sockets.delete(upstream))
    client.on("error", () => upstream.destroy())
    upstream.on("error", () => client.destroy())
  })
  server.listen(0, "127.0.0.1")
  await new Promise<void>((resolveReady, rejectReady) => {
    server.once("listening", resolveReady)
    server.once("error", rejectReady)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new TypeError("Proxy port unavailable")
  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    },
  }
}

test("Compose completes the same consented synthetic study through HTTPS and offline export", async ({
  browser,
}) => {
  test.setTimeout(240_000)
  const project = `task31-${randomUUID().slice(0, 8)}`
  activeProject = project
  const args = [
    "compose",
    "-p",
    project,
    "-f",
    "deploy/compose.yml",
    "-f",
    "tests/deployment/compose-synthetic.yml",
  ]
  const compose = (command: readonly string[]): string =>
    execFileSync("docker", [...args, ...command], {
      cwd: root,
      env: environment,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
    }).trim()
  let proxy: Awaited<ReturnType<typeof proxyToPort>> | undefined
  let isolated: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    compose(["build"])
    compose([
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
    compose(["up", "-d", "--wait", "--wait-timeout", "120"])
    expect(
      compose([
        "exec",
        "-T",
        "api",
        "node",
        "--experimental-transform-types",
        "scripts/library.ts",
        "--help",
      ]),
    ).toContain("maintenance-recover")
    const binding = compose(["port", "proxy", "443"])
    const port = Number(binding.split(":").at(-1))
    if (!Number.isInteger(port)) throw new TypeError("Hosted proxy binding unavailable")
    proxy = await proxyToPort(port)
    isolated = await chromium.launch({ args: ["--proxy-bypass-list=<-loopback>"] })
    context = await isolated.newContext({
      ignoreHTTPSErrors: true,
      proxy: { server: proxy.url },
      acceptDownloads: true,
    })
    const page = await context.newPage()
    page.setDefaultNavigationTimeout(15_000)
    const journey = await runDeployedJourney(page, "https://localhost", evidence)
    expect(journey).toHaveProperty("runId", expect.any(String))
    expect(journey).toHaveProperty("manifestPath", expect.stringContaining("/runs/"))
    const records = Task31Records.parse(
      JSON.parse(
        compose([
          "exec",
          "-T",
          "api",
          "node",
          "--experimental-transform-types",
          "apps/server/src/testing/task31-records.ts",
          journey.studyId,
          journey.forkId,
        ]),
      ),
    )
    expect(records.fork.parent).toEqual({
      studyId: journey.studyId,
      setupRevisionId: records.original.setupId,
    })
    expect(records.original.publication.lessonId).toBe(journey.lessonId)
    expect(records.original.outputs.map((output) => output.state)).toEqual(["released", "released"])
    await context.close()
    context = undefined
    await isolated.close()
    isolated = undefined
    await proxy.stop()
    proxy = undefined
    compose(["down", "--volumes", "--remove-orphans"])
    await verifyDeployedOffline(browser, journey.runDir)
    await verifyDeployedEvidence(journey, records, "compose")
    await assertSavedManifest(journey, records, "compose")
  } catch (error: unknown) {
    if (error instanceof Error) {
      process.stderr.write(`${compose(["ps", "--all"])}\n`)
      process.stderr.write(`${compose(["logs", "--no-color", "--tail", "40", "api", "worker"])}\n`)
    }
    throw error
  } finally {
    await Promise.race([context?.close(), delay(5_000)])
    await Promise.race([isolated?.close(), delay(5_000)])
    await Promise.race([proxy?.stop(), delay(5_000)])
    compose(["down", "--volumes", "--remove-orphans"])
    activeProject = undefined
  }
})
