import { statSync } from "node:fs"
import { join } from "node:path"
import type { LocalSubscriptionProvider } from "@reading-studio/contracts"
import { z } from "zod"

function present(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch (error) {
    const parsed = z.object({ code: z.string() }).safeParse(error)
    if (!parsed.success) throw error
    return parsed.data.code !== "ENOENT"
  }
}
export function hasCustomSubscriptionProfile(
  home: string | undefined,
  provider: LocalSubscriptionProvider,
): boolean {
  const system = {
    "chatgpt-subscription": [
      "/etc/codex/config.toml",
      "/etc/codex/requirements.toml",
      "/etc/codex/managed_config.toml",
    ],
    "grok-subscription": [
      "/etc/grok/requirements.toml",
      "/etc/grok/managed_config.toml",
      "/etc/claude-code/managed-settings.json",
      "/Library/Application Support/ClaudeCode/managed-settings.json",
    ],
  }[provider]
  return [
    ...system,
    ...(home
      ? [
          join(home, "config.toml"),
          join(home, "managed_config.toml"),
          ...(provider === "chatgpt-subscription" ? [join(home, "requirements.toml")] : []),
        ]
      : []),
  ].some(present)
}
export function ownedPolicyStamp(home: string, provider: LocalSubscriptionProvider): string | null {
  if (provider !== "grok-subscription") return null
  try {
    const stat = statSync(join(home, "requirements.toml"), { bigint: true })
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":")
  } catch (error) {
    if (!z.object({ code: z.string() }).safeParse(error).success) throw error
    return null
  }
}
