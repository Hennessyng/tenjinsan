import { execFileSync } from "node:child_process"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertWasmOnlyPackages,
  installedPdfPackages,
} from "@reading-studio/ingestion/pdf-dependency-policy"

const root = fileURLToPath(new URL("../", import.meta.url))
const parsed: unknown = JSON.parse(
  execFileSync(
    "bun",
    [
      "--no-env-file",
      "-e",
      "process.stdout.write(JSON.stringify(Bun.JSONC.parse(require('node:fs').readFileSync('bun.lock', 'utf8'))))",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  ),
)
if (
  typeof parsed !== "object" ||
  parsed === null ||
  !("packages" in parsed) ||
  typeof parsed.packages !== "object" ||
  parsed.packages === null
)
  throw new TypeError("Invalid lock package table")
const locked: string[] = []
for (const [name, value] of Object.entries(parsed.packages)) {
  const first: unknown = Array.isArray(value) ? value[0] : undefined
  if (typeof first !== "string") throw new TypeError("Invalid lock package record")
  locked.push(name, first)
}
assertWasmOnlyPackages(locked)
const roots = [
  join(root, "node_modules"),
  ...["apps", "packages"].flatMap((group) =>
    readdirSync(join(root, group)).map((member) => join(root, group, member, "node_modules")),
  ),
]
const installed = installedPdfPackages(roots)
assertWasmOnlyPackages(installed)
console.log(
  JSON.stringify({
    status: "PASS",
    policy:
      "lock and installed local trees; frozen graph intentionally narrower than upstream optional manifest",
    lockedRecords: locked.length / 2,
    installedPdfPackages: installed,
    linuxFrozenInstall: "UNVERIFIED; no Linux/container install performed",
  }),
)
