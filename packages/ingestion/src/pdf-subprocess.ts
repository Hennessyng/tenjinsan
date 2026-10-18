import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { ArchiveError } from "./archive-policy.ts"
import { DOCUMENT_LIMITS } from "./document-policy.ts"

export type PdfProcessLimits = { readonly [Key in keyof typeof DOCUMENT_LIMITS.pdf]: number }

export async function runPdfProcess(
  bytes: Buffer,
  worker: URL,
  limits: PdfProcessLimits = DOCUMENT_LIMITS.pdf,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      ["--max-old-space-size=128", fileURLToPath(worker), JSON.stringify(limits)],
      {
        timeout: limits.milliseconds,
        maxBuffer: limits.outputBytes,
        killSignal: "SIGKILL",
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error) {
          if (
            error.killed ||
            error.signal === "SIGABRT" ||
            error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
          )
            reject(new ArchiveError("limit-exceeded", { cause: error }))
          else reject(error)
        } else resolve(stdout)
      },
    )
    child.stdin?.on("error", (error) => {
      if (!(error instanceof Error && "code" in error && error.code === "EPIPE")) reject(error)
    })
    child.stdin?.end(bytes)
  })
}
