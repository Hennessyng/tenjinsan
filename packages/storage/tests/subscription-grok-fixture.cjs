#!/usr/bin/env node
const { createInterface } = require("node:readline")
const { writeFileSync, existsSync, readFileSync, realpathSync } = require("node:fs")
const { join, basename } = require("node:path")
global.fetch = () => {
  throw new Error("Fixture network forbidden")
}
const home = process.env.GROK_HOME
if (
  !home ||
  process.env.HOME !== home ||
  !basename(process.cwd()).startsWith("tenjinsan-study-") ||
  process.cwd().startsWith(realpathSync(home)) ||
  process.env.XAI_API_KEY
)
  throw new Error("Isolation violated")
const marker = join(home, "synthetic-session")
const scenario = process.argv.find((arg) => arg.startsWith("fixture:"))?.slice(8) ?? "success"
const reply = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
let authId
let reads = 0
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params, jsonrpc } = JSON.parse(line)
  if (jsonrpc !== "2.0") throw new Error("ACP version missing")
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: 1,
        authMethods: [{ id: "grok.com" }, ...(existsSync(marker) ? [{ id: "cached_token" }] : [])],
      })
      break
    case "authenticate":
      if (params.methodId === "cached_token") {
        if (!existsSync(marker)) throw new Error("No cached session")
        reply(id, {
          _meta: {
            auth_mode: scenario === "api-mode" ? "ApiKey" : "Oidc",
            subscription_tier: "SuperGrok",
          },
        })
      } else if (
        params.methodId === "grok.com" &&
        params._meta.use_oauth === true &&
        params._meta.request_seq > 0
      )
        authId = id
      else throw new Error("Unexpected auth or API fallback")
      break
    case "_x.ai/auth/get_url":
      reply(id, {
        auth_url: "https://auth.x.ai/oauth2/authorize?state=synthetic",
        mode: "loopback",
        external_provider: false,
      })
      if (scenario !== "pending") {
        writeFileSync(marker, "synthetic")
        if (scenario === "denied")
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: authId,
              error: { code: -32000, message: "PRIVATE error" },
            }) + "\n",
          )
        else reply(authId, { _meta: { auth_mode: "Oidc", subscription_tier: "SuperGrok" } })
      }
      break
    case "_x.ai/auth/info": {
      const counter = join(home, "synthetic-reads")
      reads = existsSync(counter) ? Number(readFileSync(counter, "utf8")) + 1 : 1
      writeFileSync(counter, String(reads))
      reply(id, {
        methodId: "cached_token",
        email: "grok@example.test",
        principalType: "user",
        principalId: scenario === "changed-account" && reads > 1 ? "user-other" : "user-fixture",
        teamId: null,
      })
      break
    }
    case "_x.ai/models/list":
      reply(id, {
        result: {
          currentModelId: "offered-grok",
          availableModels: [{ modelId: "offered-grok", name: "Grok offered model" }],
        },
        error: null,
      })
      break
    default:
      throw new Error("Unexpected RPC: " + method)
  }
})
