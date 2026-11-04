import { FullBookConsentError } from "@reading-studio/contracts"
import { z } from "zod"
import type { ManagedDiagnostic } from "./full-book-managed-diagnostic.ts"
import { ManagedCollectionError } from "./full-book-managed-stream.ts"
import { parseFields } from "./protocol-observation.ts"
import { RpcFrameError } from "./rpc-frame.ts"
import { SubscriptionRpcFault } from "./subscription-rpc-fault.ts"
import { SubscriptionRpcRejection } from "./subscription-rpc-rejection.ts"
export function managedFailureDiagnostic(error: unknown): z.infer<typeof ManagedDiagnostic> {
  if (error instanceof ManagedCollectionError && error.diagnostic) return error.diagnostic
  if (error instanceof SubscriptionRpcFault)
    return {
      category: "transport",
      stage: "rpc",
      site: error.site,
      method: error.method,
      fields: error.fields,
      ...(error.frameCode ? { frameCode: error.frameCode } : {}),
      ...(error.observation ? { transport: error.observation } : {}),
    }
  if (error instanceof SubscriptionRpcRejection)
    return {
      category: "rpc-rejection",
      stage: "setup-response",
      site: "rpc-rejection",
      code: error.rpcCode,
    }
  if (error instanceof RpcFrameError)
    return {
      category: "transport",
      stage: "rpc",
      site: "frame-invalid",
      frameCode: error.code,
      fields: [],
    }
  return {
    category: "runner",
    stage: "runner",
    site:
      error instanceof FullBookConsentError
        ? "runner-authority"
        : error instanceof ManagedCollectionError && error.reason === "cancelled"
          ? "cancelled"
          : "runner-setup",
    fields: error instanceof z.ZodError ? parseFields(error) : [],
  }
}
