import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type ProxyOptions } from "vite"
import { startupPlugin } from "./src/i18n/startup.ts"

const { SERVER_PORT, STUDIO_PORT } = process.env
const apiOrigin = `http://127.0.0.1:${SERVER_PORT ?? "8787"}`
const studioOrigin = `http://127.0.0.1:${STUDIO_PORT ?? "4173"}`
const ownerProxy = {
  target: apiOrigin,
  changeOrigin: true,
  configure(proxy) {
    proxy.on("proxyReq", (request, incoming) => {
      if (incoming.headers.origin === studioOrigin) request.setHeader("origin", apiOrigin)
    })
  },
} satisfies ProxyOptions

export default defineConfig({
  plugins: [startupPlugin(), react(), tailwindcss()],
  server: {
    proxy: {
      "/publication-artifacts": { target: apiOrigin, changeOrigin: true },
      "/api": ownerProxy,
      "^/(login|logout|entrance-decoration\\.js)(?:\\?|$)": ownerProxy,
    },
  },
})
