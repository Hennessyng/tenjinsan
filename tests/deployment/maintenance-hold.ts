import { existsSync, writeSync } from "node:fs"
import { captureLibrary } from "@reading-studio/storage"

const [databasePath, privateDataRoot, releasePath] = process.argv.slice(2)
if (!databasePath || !privateDataRoot || !releasePath)
  throw new TypeError("Missing maintenance fixture paths")
const pause = new Int32Array(new SharedArrayBuffer(4))
captureLibrary({ databasePath, privateDataRoot }, 10_000, (phase) => {
  if (phase !== "frozen") return
  writeSync(1, "frozen\n")
  const deadline = Date.now() + 10_000
  while (!existsSync(releasePath) && Date.now() < deadline) Atomics.wait(pause, 0, 0, 25)
  if (!existsSync(releasePath)) throw new TypeError("Maintenance fixture release timed out")
})
