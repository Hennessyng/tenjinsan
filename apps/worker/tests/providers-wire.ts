import { once } from "node:events"
import { createServer } from "node:http"

export type WireReply = { readonly status: number; readonly body: unknown } | "disconnect" | "stall"
export async function providerWire(replies: readonly WireReply[], accepted?: () => void) {
  const requests: unknown[] = []
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/models/user") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          data: [
            {
              id: "gpt-4.1-mini",
              name: "Synthetic model",
              supported_parameters: ["structured_outputs"],
            },
          ],
        }),
      )
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    accepted?.()
    const reply = replies[requests.length - 1] ?? replies.at(-1)
    if (!reply || reply === "disconnect") {
      request.socket.destroy()
      return
    }
    if (reply === "stall") return
    response.writeHead(reply.status, { "content-type": "application/json" })
    response.end(JSON.stringify(reply.body))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new TypeError("Missing fixture address")
  return {
    requests,
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
export function protocolOutput(
  provider: "openrouter" | "anthropic",
  text = '{"answer":"ok"}',
): WireReply {
  return {
    status: 200,
    body:
      provider === "openrouter"
        ? {
            id: "chatcmpl-fixture",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1-mini",
            choices: [
              { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 4 },
          }
        : {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4-6",
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
            usage: { input_tokens: 8, output_tokens: 4 },
          },
  }
}
