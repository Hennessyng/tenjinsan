#!/usr/bin/env node
const { createInterface } = require("node:readline")
const { writeFileSync, existsSync, readFileSync, realpathSync } = require("node:fs")
const { join, basename } = require("node:path")
global.fetch = () => {
  throw new Error("Fixture network forbidden")
}
const home = process.env.CODEX_HOME
const marker = join(home, "synthetic-session")
const scenario = process.argv.find((arg) => arg.startsWith("fixture:"))?.slice(8) ?? "success"
if (scenario === "orphan") setInterval(() => {}, 1000)
if (
  process.env.HOME !== home ||
  !basename(process.cwd()).startsWith("tenjinsan-study-") ||
  process.cwd().startsWith(realpathSync(home)) ||
  process.env.OPENAI_API_KEY ||
  process.env.OPENROUTER_API_KEY
)
  throw new Error("Isolation violated")
if (!process.argv.includes('forced_login_method="chatgpt"'))
  throw new Error("ChatGPT auth not pinned")
const reply = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + "\n")
const notify = (params) =>
  process.stdout.write(JSON.stringify({ method: "account/login/completed", params }) + "\n")
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line)
  switch (method) {
    case "test/pid":
      reply(id, { pid: process.pid })
      break
    case "initialize":
      reply(id, {})
      break
    case "initialized":
      break
    case "account/login/start":
      if (params.type !== "chatgpt") throw new Error("API fallback forbidden")
      reply(id, {
        type: "chatgpt",
        loginId: "login-one",
        authUrl: "https://auth.openai.com/authorize?state=synthetic",
      })
      writeFileSync(marker, "synthetic")
      notify({
        loginId: scenario === "wrong-id" ? "other-login" : "login-one",
        success: scenario !== "failed",
        error: null,
      })
      break
    case "account/read": {
      const reads = join(home, "synthetic-reads")
      const count = existsSync(reads) ? Number(readFileSync(reads, "utf8")) + 1 : 1
      writeFileSync(reads, String(count))
      reply(id, {
        account:
          existsSync(marker) && !(scenario === "expired" && count > 1)
            ? { type: "chatgpt", email: "fixture@example.test", planType: "plus" }
            : null,
        workspaceRouting: {
          chatgptAccountId:
            scenario === "changed-workspace" && count > 1 ? "workspace-other" : "workspace-fixture",
          backendOrigin: "https://chatgpt.com",
          accountRoutingOverride: "NO_CONSTRAINT",
        },
      })
      break
    }
    case "model/list":
      reply(id, {
        data: [{ model: "offered/model", displayName: "Account model", hidden: false }],
        nextCursor: null,
      })
      break
    case "account/logout":
      reply(id, {})
      break
    case "account/login/cancel":
      reply(id, { status: "canceled" })
      break
    default:
      throw new Error("Unexpected RPC: " + method)
  }
})
