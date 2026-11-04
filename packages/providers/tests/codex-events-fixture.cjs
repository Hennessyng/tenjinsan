#!/usr/bin/env node
const { createInterface } = require("node:readline")
const { readFileSync, appendFileSync } = require("node:fs")
const data = JSON.parse(readFileSync(process.argv[2], "utf8"))
global.fetch = () => {
  throw new Error("Fixture network forbidden")
}
const reply = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\n")
const notify = (method, params) => process.stdout.write(JSON.stringify({ method, params }) + "\n")
createInterface({ input: process.stdin }).on("line", (line) => {
  if (data.capture) appendFileSync(data.capture, line + "\n", "utf8")
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
    case "thread/start":
      reply(id, {
        cwd: process.cwd(),
        thread: { id: "fixture-thread" },
        model: params.model,
        modelProvider: "openai",
        instructionSources: [],
        sandbox: { type: "readOnly" },
      })
      break
    case "turn/start": {
      const acknowledge = () => reply(id, { turn: { id: "fixture-turn" } })
      if (!data.acknowledgeLast) acknowledge()
      for (const [index, event] of data.items.entries())
        notify("item/completed", {
          threadId: event.threadId ?? "fixture-thread",
          turnId: event.turnId ?? "fixture-turn",
          item: {
            type: "agentMessage",
            id: `item-${index}`,
            text: event.text,
            ...(event.phase === undefined ? {} : { phase: event.phase }),
          },
        })
      notify("thread/tokenUsage/updated", {
        threadId: "fixture-thread",
        turnId: "fixture-turn",
        tokenUsage: { last: { inputTokens: 10, outputTokens: 20 } },
      })
      if (data.closeWithoutTerminal) process.exit(0)
      notify("turn/completed", {
        threadId: "fixture-thread",
        turn: { id: "fixture-turn", status: "completed" },
      })
      if (data.acknowledgeLast) acknowledge()
      break
    }
    default:
      throw new Error("Unexpected RPC; authentication and actual provider calls forbidden")
  }
})
