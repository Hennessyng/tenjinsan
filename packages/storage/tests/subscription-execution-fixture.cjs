#!/usr/bin/env node
const { createInterface } = require("node:readline")
const { existsSync, writeFileSync, readFileSync, unlinkSync } = require("node:fs")
const { join } = require("node:path")
const { strictSchema, schemaRoot } = require("./subscription-schema-fixture.cjs")
global.fetch = () => {
  throw new Error("Fixture network forbidden")
}
const kind = process.argv.find((arg) => arg.startsWith("kind:"))?.slice(5)
const scenario = process.argv.find((arg) => arg.startsWith("scenario:"))?.slice(9) ?? "success"
const control = process.argv.find((arg) => arg.startsWith("control:"))?.slice(8)
const home = kind === "codex" ? process.env.CODEX_HOME : process.env.GROK_HOME
const marker = join(home, "fixture-session")
if (scenario === "custom-config")
  writeFileSync(join(home, "config.toml"), "# unexpected custom profile\n")
let pendingAuth
let model
const reply = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
const notify = (method, params) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n")
function output(prompt) {
  if (control) writeFileSync(join(control, "sent"), "sent")
  if (prompt.includes("WITHHELD_FIXTURE_PASSAGE")) throw new Error("Excluded content transmitted")
  const line = prompt.split("\n").findLast((value) => value.startsWith("[{"))
  const blocks = JSON.parse(line)
  const block = blocks[0]
  if (!block || typeof block.text !== "string") throw new Error("Missing approved block")
  return scenario === "malformed"
    ? "invalid"
    : JSON.stringify({
        claims: [
          {
            text: "Fixture finding",
            start: block.start,
            end: Math.min(block.end, block.start + 5),
          },
        ],
        concepts: [],
        qualifications: [],
      })
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line)
  if (!method) return
  switch (method) {
    case "initialize":
      reply(
        id,
        kind === "grok"
          ? { protocolVersion: 1, authMethods: [{ id: "grok.com" }, { id: "cached_token" }] }
          : {},
      )
      break
    case "initialized":
      break
    case "account/login/start":
      writeFileSync(marker, "fixture")
      reply(id, { type: "chatgpt", loginId: "login", authUrl: "https://auth.openai.com/authorize" })
      notify("account/login/completed", { loginId: "login", success: true })
      break
    case "account/read":
      reply(id, {
        account: existsSync(marker)
          ? { type: "chatgpt", email: "reader@example.test", planType: "plus" }
          : null,
        workspaceRouting: { chatgptAccountId: "workspace" },
      })
      break
    case "model/list":
      reply(id, {
        data: [{ model: "study-model", displayName: "Study model", hidden: false }],
        nextCursor: null,
      })
      break
    case "authenticate":
      if (params.methodId === "grok.com") pendingAuth = id
      else if (params.methodId === "cached_token" && existsSync(marker))
        reply(id, { _meta: { auth_mode: "Oidc", subscription_tier: "subscription" } })
      else throw new Error("Fallback forbidden")
      break
    case "_x.ai/auth/get_url":
      reply(id, {
        auth_url: "https://auth.x.ai/oauth2/authorize",
        mode: "loopback",
        external_provider: false,
      })
      writeFileSync(marker, "fixture")
      reply(pendingAuth, { _meta: { auth_mode: "Oidc", subscription_tier: "subscription" } })
      break
    case "_x.ai/auth/info":
      reply(id, {
        methodId: "cached_token",
        email: "reader@example.test",
        principalType: null,
        principalId: null,
        teamId: null,
      })
      break
    case "_x.ai/models/list":
      reply(id, {
        result: { availableModels: [{ modelId: "study-model", name: "Study model" }] },
        error: null,
      })
      break
    case "mcpServerStatus/list":
      reply(id, { data: [], nextCursor: null })
      break
    case "thread/start":
      if (params.cwd !== process.cwd()) throw new Error("Wrong working directory")
      if (
        !params.ephemeral ||
        params.environments?.length !== 0 ||
        params.dynamicTools?.length !== 0 ||
        params.approvalPolicy !== "never"
      )
        throw new Error("Unsafe thread")
      model = params.model
      reply(id, {
        thread: { id: "thread" },
        model: scenario === "fallback" ? "unexpected-model" : model,
        modelProvider: "openai",
        cwd: process.cwd(),
        instructionSources: [],
        sandbox: { type: "readOnly" },
      })
      break
    case "turn/start": {
      if (params.model !== model || params.environments?.length !== 0)
        throw new Error("Model or environment mismatch")
      let guidance
      try {
        guidance = JSON.parse(params.input[0].text.split("\n")[0]).responseSchema
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
      const schema = params.outputSchema ?? guidance
      if (control && existsSync(join(control, "reject-next"))) {
        unlinkSync(join(control, "reject-next"))
        reply(id, { turn: { id: "turn" } })
        notify("turn/completed", { threadId: "thread", turn: { id: "turn", status: "failed" } })
        break
      }
      if (
        scenario === "bad-request" ||
        (scenario === "strict-schema" && params.outputSchema && !strictSchema(params.outputSchema))
      ) {
        reply(id, { turn: { id: "turn" } })
        notify("turn/completed", {
          threadId: "thread",
          turn: {
            id: "turn",
            status: "failed",
            error: { codexErrorInfo: "badRequest", message: "PRIVATE_DIAGNOSTIC_SENTINEL" },
          },
        })
        break
      }
      const isQuestions = schemaRoot(schema)?.properties?.lenses !== undefined
      if (scenario === "strict-schema")
        writeFileSync(
          join(control, isQuestions ? "questions-wire.json" : "analysis-wire.json"),
          JSON.stringify({ nativeSchema: params.outputSchema !== undefined }),
        )
      const text =
        isQuestions && scenario === "strict-schema"
          ? readFileSync(join(control, "questions-output.json"), "utf8")
          : output(params.input[0].text)
      reply(id, { turn: { id: "turn" } })
      notify("item/completed", {
        threadId: "thread",
        turnId: "turn",
        item: { type: "agentMessage", text },
      })
      if (scenario === "revoked-inflight") {
        writeFileSync(join(control, "ready"), "ready")
        break
      }
      if (scenario === "incomplete") {
        process.exit(0)
        break
      }
      notify("turn/completed", { threadId: "thread", turn: { id: "turn", status: "completed" } })
      break
    }
    case "session/new":
      if (params.cwd !== process.cwd()) throw new Error("Wrong working directory")
      if (process.argv[process.argv.indexOf("--storage-mode") + 1] !== "local")
        throw new Error("Remote history writeback not disabled")
      if (
        process.argv[process.argv.indexOf("--tools") + 1] !== "" ||
        params.mcpServers?.length !== 0 ||
        params._meta?.yoloMode !== false
      )
        throw new Error("Unsafe Grok session")
      reply(id, { sessionId: "session" })
      break
    case "session/set_model":
      if (scenario === "fallback") {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Unsupported requested model" },
          }) + "\n",
        )
        break
      }
      model = params.modelId
      reply(id, {})
      break
    case "session/prompt": {
      if (model !== "study-model") throw new Error("Default model used")
      const text = output(params.prompt[0].text)
      notify("session/update", {
        sessionId: "session",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
      })
      if (scenario === "revoked-inflight") {
        writeFileSync(join(control, "ready"), "ready")
        break
      }
      if (scenario === "incomplete") {
        process.exit(0)
        break
      }
      reply(id, { stopReason: "end_turn" })
      break
    }
    default:
      throw new Error("Unexpected protocol operation")
  }
})
