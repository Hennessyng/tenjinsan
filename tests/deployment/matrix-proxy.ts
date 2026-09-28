import { createServer } from "node:http"
import { connect, type Socket } from "node:net"

export async function proxyToPort(port: number) {
  const sockets = new Set<Socket>()
  const server = createServer()
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  server.on("connect", (request, client, head) => {
    if (request.url !== "localhost:443") {
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n")
      return
    }
    const upstream = connect(port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length > 0) upstream.write(head)
      client.pipe(upstream)
      upstream.pipe(client)
    })
    sockets.add(upstream)
    upstream.on("close", () => sockets.delete(upstream))
    client.on("error", () => upstream.destroy())
    upstream.on("error", () => client.destroy())
  })
  server.listen(0, "127.0.0.1")
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new TypeError("Proxy port unavailable")
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
