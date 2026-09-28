import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"

export const sceneRuntime = stripTypeScriptTypes(
  readFileSync(new URL("./scene-runtime.ts", import.meta.url), "utf8"),
)
