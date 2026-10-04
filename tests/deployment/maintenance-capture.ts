import { writeSync } from "node:fs"
import { captureLibrary } from "@reading-studio/storage"

const [databasePath, privateDataRoot] = process.argv.slice(2)
if (!databasePath || !privateDataRoot) throw new TypeError("Missing maintenance paths")
writeSync(1, captureLibrary({ databasePath, privateDataRoot }, 250))
