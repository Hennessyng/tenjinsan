import { appendFileSync, existsSync, readFileSync, watch } from "node:fs"
import { dirname } from "node:path"
import { captureLibrary, openStorage } from "@reading-studio/storage"
import { Archive, FixtureDatabase, restoreLibrary } from "@reading-studio/storage/test-support"
import { afterEach, expect, it, vi } from "vitest"
import { z } from "zod"
import { executionClock as clock } from "./full-book-execution-fixture.ts"
import { managedProcess } from "./full-book-managed-process-fixture.ts"
import { portableDestination } from "./full-book-portable-fixture.ts"

afterEach(() => vi.unstubAllEnvs())
it.each(["build", "settings", "account"])(
  "refuses %s mismatch before any process/account RPC or attempt reservation",
  async (mismatch) => {
    // Given persisted native authorization whose selected build or current authority no longer matches.
    const f = managedProcess()
    try {
      switch (mismatch) {
        case "build":
          appendFileSync(f.grant.policy.build.binaryPath, "\n// fixture mutation\n")
          break
        case "settings":
          f.storage.sources.appendSetup({
            record: {
              ...f.setup,
              id: "changed-native-settings",
              analysis: {
                ...f.setup.analysis,
                settings: { ...f.setup.analysis.settings, temperature: 0.5 },
              },
            },
            parentRevisionId: f.setup.id,
          })
          break
        case "account":
          f.storage.subscriptionConnections.disconnect(
            f.budget.session.destination.installationId,
            "chatgpt-subscription",
          )
          break
        default:
          throw new TypeError("Unknown mismatch fixture")
      }
      // When/Then no alternate account/model or silently ignored settings can enter before startup.
      await expect(
        f.storage.fullBookManaged.run(f.grant.id, {
          signal: new AbortController().signal,
          now: () => clock.now,
        }),
      ).rejects.toThrow()
      expect(existsSync(f.capture)).toBe(false)
      expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(0)
    } finally {
      f.cleanup()
    }
  },
)
it("cannot enter the native path with only an ordinary source-budget consent", async () => {
  // Given a budget manifest without the distinct native authorization ID.
  const f = managedProcess()
  try {
    // When/Then it is rejected before process startup or account/model RPC.
    await expect(
      f.storage.fullBookManaged.run(f.budget.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      }),
    ).rejects.toThrow()
    expect(existsSync(f.capture)).toBe(false)
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(0)
  } finally {
    f.cleanup()
  }
})

it("cancels after an actual owned turn write while retaining its one charged unknown", async () => {
  // Given a fake process that never finishes the turn, observed through actual captured stdin.
  const f = managedProcess("stall"),
    controller = new AbortController()
  const watcher = watch(dirname(f.capture), () => {
    if (existsSync(f.capture) && readFileSync(f.capture, "utf8").includes('"method":"turn/start"'))
      controller.abort()
  })
  try {
    // When cancellation follows that write, not a timer/sleep approximation.
    expect(
      await f.storage.fullBookManaged.run(f.grant.id, {
        signal: controller.signal,
        now: () => clock.now,
      }),
    ).toMatchObject({ kind: "outcome-unknown" })
    // Then no partial output or extra retry is accepted.
    expect(controller.signal.aborted).toBe(true)
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(1)
    expect(f.storage.fullBookExecution.attempts(f.budget.id)[0]).toMatchObject({
      state: "outcome_unknown",
    })
    expect(f.storage.fullBookExecution.receipts(f.budget.id)).toHaveLength(0)
  } finally {
    watcher.close()
    f.cleanup()
  }
}, 15_000)

it("refuses fresh-thread replay instead of reusing prior history for a counted repair", async () => {
  // Given a malformed first response and a fake server that reuses its thread identity.
  const f = managedProcess("replay")
  try {
    expect(
      await f.storage.fullBookManaged.run(f.grant.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      }),
    ).toMatchObject({ kind: "repair-required" })
    // When a second explicitly invoked attempt tries to reuse that identity.
    expect(
      await f.storage.fullBookManaged.run(f.grant.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      }),
    ).toMatchObject({ kind: "outcome-unknown" })
    // Then the second source-bearing turn was never written, but both reservations remain counted.
    const methods = readFileSync(f.capture, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => z.object({ method: z.string() }).parse(JSON.parse(line)).method)
    expect(methods.filter((method) => method === "turn/start")).toHaveLength(1)
    expect(f.storage.fullBookExecution.attempts(f.budget.id)).toHaveLength(2)
  } finally {
    f.cleanup()
  }
})

it.each([
  {
    mode: "seen-close",
    usage: { kind: "known", inputTokens: 8, outputTokens: 4 },
    diagnostic: { category: "transport", stage: "rpc", site: "process-closed" },
  },
  {
    mode: "rpc-error",
    usage: { kind: "unknown" },
    diagnostic: {
      category: "rpc-rejection",
      stage: "turn-start-response",
      code: -32602,
      site: "rpc-rejection",
    },
  },
])(
  "ports $mode native frame/failure evidence as historical audit, never native authority",
  async ({ mode, usage, diagnostic }) => {
    // Given a synthetic collection failure with explicit owner cancellation.
    const f = managedProcess(mode),
      destination = portableDestination()
    try {
      await f.storage.fullBookManaged.run(f.grant.id, {
        signal: new AbortController().signal,
        now: () => clock.now,
      })
      const originalDb = new FixtureDatabase(f.options.databasePath)
      let originalFailure: string
      try {
        originalFailure = z
          .object({ record_json: z.string() })
          .parse(
            originalDb.prepare("SELECT record_json FROM full_book_managed_failures").get(),
          ).record_json
      } finally {
        originalDb.close()
      }
      f.storage.fullBookExecution.cancel(
        f.budget.id,
        "Explicit owner stop after native collection failure",
      )
      // When the existing portable pipeline imports the new evidence.
      const bytes = captureLibrary(f.options),
        archive = Archive.parse(JSON.parse(bytes.toString("utf8")))
      restoreLibrary(destination.options, bytes)
      // Then charges and immutable native evidence survive, without usable imported authorization.
      const restored = openStorage(destination.options)
      try {
        expect(
          restored.fullBookConsent.commitments(
            destination.owner,
            f.budget.session.input.normalization.editionHash,
          ),
        ).toEqual({ spent: 1, held: 0 })
        expect(() => restored.fullBookManagedConsents.read(f.grant.id)).toThrow()
        const auditHash = archive.payload.tables.find((table) => table.name === "full_book_imports")
          ?.rows[0]?.["id"]
        const blob = archive.payload.blobs.find((blob) => blob.hash === auditHash)
        if (!blob) throw new TypeError("Missing native audit blob")
        const audit = z
          .object({
            managed: z.object({ failures: z.array(z.object({ record_json: z.string() })) }),
          })
          .parse(JSON.parse(Buffer.from(blob.bytes, "base64").toString("utf8")))
        const failure = z
          .object({
            observedUsage: z.unknown(),
            diagnostic: z.unknown().optional(),
            partialAccepted: z.literal(false),
          })
          .parse(JSON.parse(audit.managed.failures[0]?.record_json ?? "null"))
        expect(failure.partialAccepted).toBe(false)
        expect(failure.observedUsage).toEqual(usage)
        expect(failure.diagnostic).toMatchObject(diagnostic)
        expect(JSON.parse(audit.managed.failures[0]?.record_json ?? "null")).toEqual(
          JSON.parse(originalFailure),
        )
      } finally {
        restored.close()
      }
    } finally {
      destination.cleanup()
      f.cleanup()
    }
  },
)
