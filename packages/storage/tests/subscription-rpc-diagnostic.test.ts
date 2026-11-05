import { expect, it } from "vitest"
import { ManagedDiagnostic } from "../src/full-book-managed-diagnostic.ts"
import { managedFailureDiagnostic } from "../src/full-book-managed-failure.ts"
import { FailureSite } from "../src/protocol-observation.ts"
import { RpcFrameError } from "../src/rpc-frame.ts"
import { SubscriptionRpcFault } from "../src/subscription-rpc-fault.ts"
import { readRpcLine } from "../src/subscription-rpc-reader.ts"
import { SubscriptionRpcRejection } from "../src/subscription-rpc-rejection.ts"
import { SubscriptionRpcTrace } from "../src/subscription-rpc-trace.ts"

it.each([
  ["SECRET_VALUE", "json-invalid"],
  [JSON.stringify({ id: null }), "envelope-invalid"],
  [JSON.stringify({ id: "foreign", result: {} }), "response-id"],
  [JSON.stringify({ id: 1 }), "response-empty"],
  [JSON.stringify({ id: 1, result: {}, error: {} }), "response-empty"],
  [JSON.stringify({ id: 1, error: null }), "response-error-shape"],
  [JSON.stringify({ method: "error", result: {} }), "envelope-invalid"],
  ["x".repeat(1000001), "line-size"],
])("classifies malformed envelope without retaining source, case %#", (line, site) => {
  // Given malformed untrusted line data.
  // When/Then the original fault class/site survives the boundary, never the source line.
  try {
    readRpcLine(line)
    throw new Error("Expected fault")
  } catch (error) {
    if (!(error instanceof SubscriptionRpcFault)) throw error
    expect(error.site).toBe(site)
    expect(JSON.stringify(error)).not.toContain("SECRET")
  }
})
it.each(FailureSite.options)("retains typed cause %s across stop and audit schema", (site) => {
  // Given a typed source-site fault, later stop/close must not overwrite the first observation.
  const trace = new SubscriptionRpcTrace(),
    first = trace.fail(new SubscriptionRpcFault(site))
  // When/Then shutdown preserves the source cause and observation-time unknown exit status.
  trace.closed = true
  trace.exitCode = 0
  expect(trace.fail(new SubscriptionRpcFault("stopped"))).toBe(first)
  const saved = ManagedDiagnostic.parse({
    category: "transport",
    stage: "rpc",
    site: first.site,
    fields: first.fields,
    transport: first.observation,
  })
  expect(saved).toMatchObject({
    site,
    transport: { closed: false, exitCode: null, nativeExitObserved: false },
  })
})
it("keeps frame and RPC rejection categories distinct through the runner boundary", () => {
  // Given typed lower-layer failures whose public error contracts must remain intact.
  const frame = new RpcFrameError("invalid-frame")
  const rejection = new SubscriptionRpcRejection({
    code: -32602,
    message: "SECRET_VALUE",
    data: "SECRET_VALUE",
  })
  // When/Then runner classification preserves safe subtype codes, not raw messages or causes.
  expect(managedFailureDiagnostic(frame)).toMatchObject({
    category: "transport",
    site: "frame-invalid",
    frameCode: "invalid-frame",
  })
  expect(managedFailureDiagnostic(rejection)).toMatchObject({
    category: "rpc-rejection",
    site: "rpc-rejection",
    code: -32602,
  })
  expect(JSON.stringify(managedFailureDiagnostic(rejection))).not.toContain("SECRET")
})
