import { statSync } from "node:fs"
import { get } from "node:http"
import { DatabaseSync } from "node:sqlite"

const database = new DatabaseSync("/data/studio.sqlite", { readOnly: true })
try {
  database.prepare("SELECT 1").get()
} finally {
  database.close()
}
if (process.env["HOSTED_ROLE"] === "worker") {
  if (Date.now() - statSync("/tmp/worker-ready").mtimeMs > 15_000) process.exitCode = 1
} else {
  const request = get(
    "http://127.0.0.1:8787/health",
    {
      timeout: 3_000,
      headers: { host: new URL(process.env["AUTH_BASE_URL"] ?? "").host },
    },
    (response) => {
      response.resume()
      if (response.statusCode !== 200) process.exitCode = 1
    },
  )
  request.on("timeout", () => request.destroy())
  request.on("error", () => {
    process.exitCode = 1
  })
}
