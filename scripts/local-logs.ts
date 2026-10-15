import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { z } from "zod"
import { parseLocalConfig } from "./local-config.ts"
import { readLocalLogEvents } from "./local-log-capture.ts"

const workspaceRoot = fileURLToPath(new URL("..", import.meta.url))
const argumentsSchema = z.tuple([z.literal("--trace-id"), z.uuid()])

function unavailable(traceId: string): void {
  process.stdout.write(
    `${JSON.stringify(
      {
        trace_id: traceId,
        evidence: "unavailable",
        events: [],
        guidance:
          "Diagnostic evidence is unavailable. Query the observed failure trace before restarting the local app; absence does not establish a failure cause.",
      },
      null,
      2,
    )}\n`,
  )
  process.exitCode = 1
}

export async function executeLocalLogs(argv: readonly string[]): Promise<void> {
  const parsed = argumentsSchema.safeParse(argv)
  if (!parsed.success) {
    process.stderr.write("Usage: bun run local:logs -- --trace-id <uuid>\n")
    process.exitCode = 2
    return
  }
  const config = parseLocalConfig(process.env, workspaceRoot)
  const eventsPath = join(config.privateDataRoot, "diagnostics", "events.jsonl")
  let events: Awaited<ReturnType<typeof readLocalLogEvents>>
  try {
    events = await readLocalLogEvents(eventsPath, parsed.data[1])
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      unavailable(parsed.data[1])
      return
    }
    throw error
  }
  if (events.length === 0) {
    unavailable(parsed.data[1])
    return
  }
  process.stdout.write(`${JSON.stringify({ trace_id: parsed.data[1], events }, null, 2)}\n`)
  process.exitCode = 0
}

const executablePath = process.argv[1]
if (executablePath !== undefined && import.meta.url === pathToFileURL(executablePath).href) {
  try {
    await executeLocalLogs(process.argv.slice(2))
  } catch {
    // no-excuse-ok: catch — CLI boundary never echoes an untrusted rejected value.
    process.stderr.write("Unable to read local diagnostic events.\n")
    process.exitCode = 1
  }
}
