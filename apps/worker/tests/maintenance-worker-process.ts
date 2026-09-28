import { openStorage } from "@reading-studio/storage"

const [databasePath, privateDataRoot] = process.argv.slice(2)
if (!databasePath || !privateDataRoot) throw new TypeError("Missing worker fixture paths")
const storage = openStorage({ databasePath, privateDataRoot, runtimeRole: "worker" })
const poll = setInterval(() => {
  storage.execution.claimNextJob({
    token: "worker-process",
    now: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  })
}, 50)
process.stdout.write("worker-ready\n")
process.once("SIGTERM", () => {
  clearInterval(poll)
  storage.close()
})
