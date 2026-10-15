import { execFileSync, spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, it } from "vitest"
import { z } from "zod"
import { workspaceRoot } from "./local-fixture.ts"
import {
  browserLogin,
  oldPassword,
  ownerEmail,
  recoveryFixture,
  resetPasswords,
  retainedEvent,
} from "./ten-17-owner-recovery-fixture.ts"

const priorCandidate = "d5060e45cdbaacef713c72f4769cf6b77bbf7e1d"

async function rejectedPair(
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
  email: string,
  password: string,
) {
  const context = await fixture.context()
  const response = await context.request.post(`${fixture.origin}/login`, {
    headers: { origin: fixture.origin },
    form: { email, password },
    maxRedirects: 0,
  })
  expect(response.status()).toBe(401)
  const trace = z.uuid().parse(response.headers()["x-trace-id"])
  const ready = await fixture.launchers.at(-1)?.ready()
  if (ready === undefined) throw new TypeError("Fixture capture missing")
  await retainedEvent(ready.diagnosticEventsUrl, trace)
  const result = fixture.logs(trace)
  expect(result.status).toBe(0)
  const events = z
    .object({
      events: z.array(
        z.object({
          event: z.string(),
          category: z.string(),
          status: z.number(),
          upstream_status: z.number().optional(),
          requestId: z.uuid(),
          trace_id: z.uuid(),
        }),
      ),
    })
    .parse(JSON.parse(result.stdout)).events
  expect(events).toContainEqual(
    expect.objectContaining({
      event: "auth.login.rejected",
      category: "invalid-credentials",
      status: 401,
      upstream_status: 401,
      requestId: trace,
      trace_id: trace,
    }),
  )
}

const cases = [
  { mode: "reset-bracketed", password: "clipboard雪value" },
  { mode: "reset-confirmation-burst", password: "new synthetic ASCII password" },
  { mode: "reset-action-burst", password: "new synthetic ASCII password" },
] as const

it.each(cases)(
  "preserves literal credentials across $mode delivery",
  async ({ mode, password }) => {
    const fixture = await recoveryFixture()
    try {
      expect(fixture.tty()).toBe(0)
      const capture = join(fixture.fixture.directory, "synthetic-tty-output.txt")
      const reset = spawnSync(
        "expect",
        [
          "tests/deployment/owner-tty-fixture.exp",
          "--capture",
          capture,
          "--mode",
          mode,
          "bun",
          "run",
          "owner",
        ],
        {
          cwd: fixture.root,
          env: fixture.environment,
          encoding: "utf8",
          timeout: 10_000,
        },
      )
      if (reset.error !== undefined) throw reset.error
      expect(reset.stdout).toBe("")
      expect(reset.status).toBe(0)
      const visible = await readFile(capture, "utf8")
      expect(visible).not.toContain(password)
      expect(visible).toContain("*")
      await fixture.start()
      const context = await fixture.context()
      expect(await browserLogin(context, fixture.origin, password)).toBe(303)
      expect((await context.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(
        200,
      )
    } finally {
      await fixture.close()
    }
  },
  90_000,
)

it("requires a fresh fixed-reader reset to replace a credential stored by the old parser", async () => {
  const fixture = await recoveryFixture()
  try {
    const current = await readFile(join(fixture.root, "apps/server/src/owner-cli.ts"))
    const old = execFileSync("git", ["show", `${priorCandidate}:apps/server/src/owner-cli.ts`], {
      cwd: workspaceRoot,
    })
    await writeFile(join(fixture.root, "apps/server/src/owner-cli.ts"), old)
    expect(fixture.tty()).toBe(0)
    const reset = spawnSync(
      "expect",
      [
        "tests/deployment/owner-tty-fixture.exp",
        "--mode",
        "reset-bracketed",
        "bun",
        "run",
        "owner",
      ],
      { cwd: fixture.root, env: fixture.environment, encoding: "utf8", timeout: 10_000 },
    )
    expect(reset.status).toBe(0)
    await fixture.start()
    await rejectedPair(fixture, ownerEmail, "clipboard雪value")
    await fixture.stop()
    await writeFile(join(fixture.root, "apps/server/src/owner-cli.ts"), current)
    await fixture.start()
    await rejectedPair(fixture, ownerEmail, "clipboard雪value")
    await fixture.stop()
    const fixedReset = spawnSync(
      "expect",
      [
        "tests/deployment/owner-tty-fixture.exp",
        "--mode",
        "reset-bracketed",
        "bun",
        "run",
        "owner",
      ],
      { cwd: fixture.root, env: fixture.environment, encoding: "utf8", timeout: 10_000 },
    )
    expect(fixedReset.status).toBe(0)
    await fixture.start()
    const accepted = await fixture.context()
    expect(await browserLogin(accepted, fixture.origin, "clipboard雪value")).toBe(303)
    expect((await accepted.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(200)
  } finally {
    await fixture.close()
  }
}, 90_000)

it("shows identity and differing-installation controls have the same nondiagnostic rejection category", async () => {
  const fixture = await recoveryFixture()
  const other = await recoveryFixture()
  try {
    expect(fixture.tty()).toBe(0)
    expect(other.tty()).toBe(0)
    expect(other.tty("reset-ascii")).toBe(0)
    await fixture.start()
    await rejectedPair(fixture, "another-synthetic@example.test", oldPassword)
    await rejectedPair(fixture, ownerEmail, resetPasswords["reset-ascii"])
    const context = await fixture.context()
    expect(await browserLogin(context, fixture.origin, oldPassword)).toBe(303)
  } finally {
    await other.close()
    await fixture.close()
  }
}, 90_000)

it("reads updated credentials in an already-running owned server without changing its version", async () => {
  const fixture = await recoveryFixture()
  try {
    expect(fixture.tty()).toBe(0)
    const ready = await fixture.start()
    // Contrast only: user recovery procedure still requires a stopped reset and clean restart.
    expect(fixture.tty("reset-ascii")).toBe(0)
    const context = await fixture.context()
    expect(await browserLogin(context, fixture.origin, resetPasswords["reset-ascii"])).toBe(303)
    expect((await fixture.launchers.at(-1)?.ready())?.launcherPid).toBe(ready.launcherPid)
  } finally {
    await fixture.close()
  }
}, 90_000)

it.each(["provision-burst", "reset-burst-mismatch", "reset-eof"] as const)(
  "keeps masking and credential state safe through %s",
  async (mode) => {
    const fixture = await recoveryFixture()
    try {
      if (mode !== "provision-burst") expect(fixture.tty()).toBe(0)
      const capture = join(fixture.fixture.directory, "synthetic-transition-output.txt")
      const result = spawnSync(
        "expect",
        [
          "tests/deployment/owner-tty-fixture.exp",
          "--capture",
          capture,
          "--mode",
          mode,
          "bun",
          "run",
          "owner",
        ],
        {
          cwd: fixture.root,
          env: fixture.environment,
          encoding: "utf8",
          timeout: 10_000,
        },
      )
      if (result.error !== undefined) throw result.error
      expect(result.status).toBe(mode === "provision-burst" ? 0 : 2)
      expect(result.stdout).toBe("")
      const visible = await readFile(capture, "utf8")
      for (const secret of [
        oldPassword,
        "new synthetic ASCII password",
        "different confirmation",
      ]) {
        expect(visible).not.toContain(secret)
      }
      await fixture.start()
      const context = await fixture.context()
      expect(await browserLogin(context, fixture.origin, oldPassword)).toBe(303)
      expect((await context.request.get(`${fixture.origin}/api/library-context`)).status()).toBe(
        200,
      )
      if (mode !== "provision-burst") {
        await fixture.stop()
        expect(fixture.tty("reset-ascii")).toBe(0)
        await fixture.start()
        const fresh = await fixture.context()
        expect(await browserLogin(fresh, fixture.origin, resetPasswords["reset-ascii"])).toBe(303)
      }
    } finally {
      await fixture.close()
    }
  },
  90_000,
)
