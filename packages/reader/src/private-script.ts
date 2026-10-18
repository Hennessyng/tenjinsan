import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"

export const privateReaderRuntime = stripTypeScriptTypes(
  readFileSync(new URL("./private-runtime.ts", import.meta.url), "utf8"),
)
