const { createInterface } = require("node:readline")
const { readFileSync, writeFileSync, appendFileSync } = require("node:fs")
const { join } = require("node:path")
global.fetch = () => {
  throw new Error("Fixture external network forbidden")
}
const control = process.argv.find((arg) => arg.startsWith("control:"))?.slice(8)
if (!control) throw new Error("Missing synthetic control directory")
const reply = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\n")
const notify = (method, params) => process.stdout.write(JSON.stringify({ method, params }) + "\n")
let model
const thread = `synthetic-thread-${process.pid}`
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line)
  switch (method) {
    case "initialize":
      reply(id, {})
      break
    case "initialized":
      break
    case "mcpServerStatus/list":
      reply(id, { data: [], nextCursor: null })
      break
    case "thread/start": {
      if (
        !params.ephemeral ||
        params.modelProvider !== "openai" ||
        params.allowProviderModelFallback !== false ||
        params.cwd !== process.cwd() ||
        params.dynamicTools.length ||
        params.environments.length ||
        params.approvalPolicy !== "never"
      )
        throw new Error("Unsafe synthetic thread")
      model = params.model
      const pending = JSON.parse(readFileSync(join(control, "responses.json"), "utf8"))[
        Number(readFileSync(join(control, "cursor"), "utf8"))
      ]
      reply(id, {
        thread: { id: thread },
        model: pending?.fixtureTransport === "model-fallback" ? "unexpected-model" : model,
        modelProvider: "openai",
        cwd: process.cwd(),
        instructionSources: [],
        sandbox: { type: "readOnly" },
      })
      break
    }
    case "turn/start": {
      if (
        params.model !== model ||
        params.threadId !== thread ||
        !Array.isArray(params.input) ||
        params.environments.length
      )
        throw new Error("Wrong synthetic turn")
      if (params.input.some((item) => item.text?.includes("WITHHELD_FIXTURE_PASSAGE")))
        throw new Error("Withheld content transmitted")
      const index = Number(readFileSync(join(control, "cursor"), "utf8"))
      const responses = JSON.parse(readFileSync(join(control, "responses.json"), "utf8"))
      let output = responses[index]
      if (output === undefined) throw new Error("Unexpected extra invocation")
      writeFileSync(join(control, "cursor"), String(index + 1))
      appendFileSync(join(control, "requests.jsonl"), JSON.stringify(params) + "\n")
      if (output.fixtureAction) {
        const text = params.input[0]?.text
        const payload = JSON.parse(text.split("\n").findLast((value) => value.startsWith("[{")))
        if (
          !["original-verification", "batched-original-verification"].includes(payload[0]?.kind) ||
          payload.length < 2
        )
          throw new Error("Original context missing")
        output = {
          decisions: payload[0].interpretations.map((item) => ({
            id: item.id,
            verdict: output.fixtureAction === "supported" ? "supported" : "overstated",
            explanation: "Authored fixture verdict, not live comprehension",
          })),
          ...(["windows-original-check-3", "batched-original-check-4"].includes(
            payload[0].verificationVersion,
          ) || payload[0].kind === "batched-original-verification"
            ? {
                mapCoverage:
                  payload[0].mapCoverageRequired || payload[0].task === "map-omission"
                    ? {
                        verdict: "none",
                        explanation: "Authored synthetic omission state; not live comprehension",
                        sources: [],
                      }
                    : null,
              }
            : {}),
        }
      }
      const turn = `synthetic-turn-${index}`
      reply(id, { turn: { id: turn } })
      if (output.fixtureTransport === "disconnect") process.exit(0)
      if (output.fixtureTransport === "rate-limited") {
        notify("turn/completed", {
          threadId: thread,
          turn: { id: turn, status: "failed", error: { codexErrorInfo: "rateLimitExceeded" } },
        })
        break
      }
      notify("thread/tokenUsage/updated", {
        threadId: thread,
        tokenUsage: {
          last:
            output.fixtureTransport === "unsupported-phase" ||
            output.fixtureTransport === "bad-request"
              ? { inputTokens: 10, outputTokens: 20 }
              : { inputTokens: 8, outputTokens: 4 },
        },
      })
      if (output.fixtureTransport === "bad-request") {
        notify("turn/completed", {
          threadId: thread,
          turn: {
            id: turn,
            status: "failed",
            error: { codexErrorInfo: "badRequest", message: "PRIVATE_DIAGNOSTIC_SENTINEL" },
          },
        })
        break
      }
      let message = output
      if (
        output.fixtureTransport === "incomplete" ||
        output.fixtureTransport === "hold-after-item"
      ) {
        const { fixtureTransport: _mode, ...content } = output
        message = content
      }
      notify("item/completed", {
        threadId: thread,
        turnId: turn,
        item: {
          type: "agentMessage",
          phase:
            output.fixtureTransport === "unsupported-phase"
              ? "PRIVATE_NATIVE_PHASE"
              : "final_answer",
          text:
            output.fixtureTransport === "unsupported-phase"
              ? "PRIVATE_NATIVE_TEXT"
              : typeof message === "string"
                ? message
                : JSON.stringify(message),
        },
      })
      if (output.fixtureTransport === "incomplete") process.exit(0)
      if (output.fixtureTransport === "hold-after-item") {
        writeFileSync(join(control, "held"), "ready")
        break
      }
      notify("turn/completed", { threadId: thread, turn: { id: turn, status: "completed" } })
      break
    }
    default:
      throw new Error(`Unexpected RPC operation: ${method}`)
  }
})
