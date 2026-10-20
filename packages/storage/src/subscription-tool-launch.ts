import { fork } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { LocalSubscriptionProvider } from "@reading-studio/contracts"
import { hasCustomSubscriptionProfile, ownedPolicyStamp } from "./subscription-profile.ts"
import { SubscriptionLoginError } from "./subscription-session-store.ts"

export function launchSubscriptionTool(home: string, provider: LocalSubscriptionProvider) {
  if (process.platform === "win32") throw new SubscriptionLoginError("tool-unavailable")
  if (hasCustomSubscriptionProfile(home, provider))
    throw new SubscriptionLoginError("custom-configuration")
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const cwd = mkdtempSync(join(realpathSync("/tmp"), "tenjinsan-study-"))
  let binary: string
  let args: string[]
  switch (provider) {
    case "chatgpt-subscription":
      binary = process.env["STUDIO_SUBSCRIPTION_CODEX_BINARY"] ?? "codex"
      args = [
        "app-server",
        "-c",
        'forced_login_method="chatgpt"',
        "-c",
        'cli_auth_credentials_store="file"',
        "-c",
        "features.shell_tool=false",
        "-c",
        'web_search="disabled"',
        "-c",
        "features.code_mode=false",
        "-c",
        "features.code_mode_host=false",
        "-c",
        "features.multi_agent=false",
        "-c",
        "features.hooks=false",
        "-c",
        "features.plugins=false",
        "-c",
        "features.apps=false",
        "-c",
        "features.memory_tool=false",
        "-c",
        "features.view_image=false",
        "-c",
        "project_doc_max_bytes=0",
        "-c",
        "mcp_servers={}",
      ]
      break
    case "grok-subscription":
      binary = process.env["STUDIO_SUBSCRIPTION_GROK_BINARY"] ?? "grok"
      writeFileSync(
        join(home, "requirements.toml"),
        '[auth]\npreferred_method = "oidc"\n[grok_com_config]\ndisable_api_key_auth = true\n',
        { mode: 0o600 },
      )
      args = [
        "--tools",
        "",
        "--no-memory",
        "--no-subagents",
        "--disable-web-search",
        "--no-plan",
        "--max-turns",
        "1",
        "--storage-mode",
        "local",
        "agent",
        "stdio",
      ]
      break
    default:
      return assertNever(provider)
  }
  const stamp = ownedPolicyStamp(home, provider)
  const child = fork(
    new URL("./subscription-tool-supervisor.ts", import.meta.url),
    [join(dirname(home), "session-process-lock.sqlite"), binary, ...args],
    {
      cwd,
      execArgv: [],
      stdio: ["pipe", "pipe", "ignore", "ipc"],
      env: {
        PATH: process.env["PATH"],
        HOME: home,
        CODEX_HOME: home,
        GROK_HOME: home,
        GROK_MEMORY: "0",
        GROK_SUBAGENTS: "0",
      },
    },
  )
  return {
    child,
    cwd,
    profileAllowed: () =>
      !hasCustomSubscriptionProfile(home, provider) && ownedPolicyStamp(home, provider) === stamp,
  }
}
function assertNever(value: never): never {
  throw new TypeError(`Unexpected subscription provider: ${value}`)
}
