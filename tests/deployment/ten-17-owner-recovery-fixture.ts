import { spawnSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { delimiter, dirname, join, relative, resolve } from "node:path"
import type { Browser, BrowserContext } from "@playwright/test"
import { chromium } from "@playwright/test"
import { expect } from "vitest"
import { z } from "zod"
import {
  isProcessRunning,
  LocalLauncher,
  makeLocalFixture,
  occupyPort,
  releasePort,
  removeLocalFixture,
} from "./local-fixture.ts"
import { copyWorkspace } from "./ten-17-workspace.ts"

export const ownerEmail = "owner@example.test"
export const oldPassword = "correct horse battery staple"
export const resetPasswords = {
  "reset-split": "before桜after",
  "reset-emoji": "before雪after",
  "reset-unicode": "日本語かなé",
  "reset-literal": ' leading 雪 "\\ trailing ',
  "reset-single": "雪",
  "reset-max": "x".repeat(128),
  "reset-ascii": "new synthetic ASCII password",
} as const
export type ResetMode = keyof typeof resetPasswords
export type InvalidMode = "reset-mismatch" | "reset-empty" | "reset-overlimit" | "reset-interrupt"

export class RecoveryFixture {
  readonly launchers: LocalLauncher[] = []
  browser: Browser | undefined

  constructor(
    readonly fixture: Awaited<ReturnType<typeof makeLocalFixture>>,
    readonly root: string,
    readonly environment: NodeJS.ProcessEnv,
  ) {}

  get origin(): string {
    return this.environment["AUTH_BASE_URL"] ?? ""
  }

  tty(mode: ResetMode | InvalidMode | "provision" = "provision"): number | null {
    const result = spawnSync(
      "expect",
      ["tests/deployment/owner-tty-fixture.exp", "--mode", mode, "bun", "run", "owner"],
      {
        cwd: this.root,
        env: this.environment,
        encoding: "utf8",
        timeout: 30_000,
      },
    )
    if (result.error !== undefined) throw result.error
    // The controlling-terminal fixture deliberately emits no submitted values.
    expect(result.stdout).toBe("")
    return result.status
  }

  async start(root = this.root): Promise<Awaited<ReturnType<LocalLauncher["ready"]>>> {
    const launcher = new LocalLauncher(this.environment, root)
    this.launchers.push(launcher)
    return launcher.ready()
  }

  async stop(): Promise<void> {
    const launcher = this.launchers.at(-1)
    if (launcher === undefined) throw new TypeError("Fixture launcher missing")
    const ready = await launcher.ready()
    await launcher.stop(ready.launcherPid)
    for (const pid of Object.values(ready.children)) expect(isProcessRunning(pid)).toBe(false)
  }

  async startPrevious(root: string): Promise<void> {
    const launcher = new LocalLauncher(this.environment, root)
    this.launchers.push(launcher)
    await launcher.waitForOutput('"event":"local-ready"')
    const line = launcher.output
      .split("\n")
      .find((row) => row.startsWith("LOCAL_EVENT ") && row.includes("local-ready"))
    if (line === undefined) throw new TypeError("Pinned runtime readiness missing")
    const ready = z
      .object({
        event: z.literal("local-ready"),
        apiUrl: z.url(),
        launcherPid: z.number().int().positive(),
      })
      .parse(JSON.parse(line.slice("LOCAL_EVENT ".length)))
    expect(ready.apiUrl).toBe(this.origin)
  }

  async context(options: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
    this.browser ??= await chromium.launch()
    return this.browser.newContext(options)
  }

  logs(trace: string, args: readonly string[] = ["--", "--trace-id", trace]) {
    const result = spawnSync("bun", ["run", "local:logs", ...args], {
      cwd: this.root,
      env: this.environment,
      encoding: "utf8",
      timeout: 10_000,
    })
    if (result.error !== undefined) throw result.error
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }

  async close(): Promise<void> {
    await this.browser?.close()
    for (const launcher of this.launchers) {
      if (launcher.child.exitCode === null && launcher.child.signalCode === null)
        launcher.forceStop()
      await launcher.waitForExit()
    }
    await removeLocalFixture(this.fixture)
  }
}

export async function recoveryFixture(
  options: { readonly defaultOrigin?: boolean; readonly relativePaths?: boolean } = {},
): Promise<RecoveryFixture> {
  if (options.defaultOrigin) await releasePort(await occupyPort(8787))
  const fixture = await makeLocalFixture(false)
  try {
    const root = await copyWorkspace(fixture.directory)
    const data = options.relativePaths
      ? join(root, "disposable data")
      : join(fixture.directory, "private data")
    const privateRoot = join(data, "library files")
    const home = join(fixture.directory, "empty home")
    await mkdir(privateRoot, { recursive: true, mode: 0o700 })
    await mkdir(home)
    const port = options.defaultOrigin ? 8787 : fixture.apiPort
    const environment = {
      PATH: [
        dirname(process.execPath),
        resolve(dirname(process.execPath), "../../../bun/1.4.2/bin"),
        ...(process.env["PATH"] ?? "")
          .split(delimiter)
          .filter((path) => !path.includes("mise/shims")),
      ].join(delimiter),
      HOME: home,
      TMPDIR: fixture.directory,
      AUTH_BASE_URL: `http://127.0.0.1:${port}`,
      AUTH_SECRET: "ten-17-synthetic-secret-at-least-thirty-two-characters",
      DATABASE_PATH: options.relativePaths
        ? relative(root, join(data, "studio.sqlite"))
        : join(data, "studio.sqlite"),
      PRIVATE_DATA_ROOT: options.relativePaths ? relative(root, privateRoot) : privateRoot,
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: String(port),
      STUDIO_PORT: String(fixture.studioPort),
      TRUSTED_ORIGINS: `http://127.0.0.1:${port}`,
      TRUST_PROXY: "0",
    }
    return new RecoveryFixture(fixture, root, environment)
  } catch (error) {
    await removeLocalFixture(fixture)
    throw error
  }
}

export async function browserLogin(
  context: BrowserContext,
  origin: string,
  password: string,
): Promise<number> {
  const page = await context.newPage()
  try {
    await page.goto(`${origin}/login`)
    await page.getByLabel("Email").fill(ownerEmail)
    await page.getByLabel("Password").fill(password)
    const response = page.waitForResponse(
      (candidate) =>
        candidate.url() === `${origin}/login` && candidate.request().method() === "POST",
    )
    await page.getByRole("button", { name: "Log in" }).click()
    return (await response).status()
  } finally {
    await page.close()
  }
}

export async function retainedEvent(url: string, trace: string): Promise<unknown> {
  const end = Date.now() + 10_000
  while (Date.now() < end) {
    const result = z
      .object({ events: z.array(z.object({ trace_id: z.uuid() }).passthrough()) })
      .parse(await (await fetch(`${url}?trace_id=${trace}`)).json())
    if (result.events.some((event) => event.trace_id === trace)) return result.events
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new TypeError("Fixture retained-capture deadline exceeded")
}
