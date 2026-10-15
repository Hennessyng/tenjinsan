import { createWriteStream } from "node:fs"
import type { Writable } from "node:stream"
import type { SecurityLogger } from "./security-events.ts"

export function createDefaultSecuritySink(
  output: Writable = createWriteStream("", {
    fd: process.stdout.fd,
    autoClose: false,
    emitClose: false,
    highWaterMark: 1024,
  }),
): SecurityLogger {
  // This writer owns only diagnostic writes. Never intercept unrelated global stdout errors.
  let failed = false
  let blocked = false
  output.on("error", () => {
    failed = true
  })
  output.on("drain", () => {
    blocked = false
  })
  return (event) => {
    if (failed || blocked || output.destroyed || !output.writable) return
    // No secondary queue: after backpressure, drop events until this owned stream drains.
    blocked = !output.write(`${JSON.stringify(event)}\n`, (error) => {
      if (error) failed = true
    })
  }
}
