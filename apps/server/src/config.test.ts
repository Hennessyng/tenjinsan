import { describe, expect, it } from "vitest"
import { parseServerConfig, ServerConfigError } from "./config.ts"

describe("server configuration", () => {
  it("parses the required host and port", () => {
    expect(
      parseServerConfig({
        AUTH_BASE_URL: "http://127.0.0.1:8787",
        AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
        DATABASE_PATH: "data/studio.sqlite",
        SERVER_HOST: "127.0.0.1",
        SERVER_PORT: "8787",
        TRUSTED_ORIGINS: "http://127.0.0.1:8787",
        TRUST_PROXY: "0",
      }),
    ).toEqual({
      authBaseURL: "http://127.0.0.1:8787",
      authSecret: "test-secret-with-at-least-thirty-two-characters",
      databasePath: "data/studio.sqlite",
      host: "127.0.0.1",
      port: 8787,
      sessionExpiresIn: 604_800,
      trustedOrigins: ["http://127.0.0.1:8787"],
      trustProxy: false,
    })
  })

  it("names missing fields without including environment values", () => {
    expect(() => parseServerConfig({})).toThrow(
      new ServerConfigError([
        "AUTH_BASE_URL",
        "AUTH_SECRET",
        "DATABASE_PATH",
        "SERVER_HOST",
        "SERVER_PORT",
        "TRUSTED_ORIGINS",
        "TRUST_PROXY",
      ]),
    )
  })

  it("rejects a port outside the TCP range", () => {
    const privateValue = "70000-private-canary"
    let capturedError: unknown

    try {
      parseServerConfig({
        AUTH_BASE_URL: "http://127.0.0.1:8787",
        AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
        DATABASE_PATH: "data/studio.sqlite",
        SERVER_HOST: "127.0.0.1",
        SERVER_PORT: privateValue,
        TRUSTED_ORIGINS: "http://127.0.0.1:8787",
        TRUST_PROXY: "0",
      })
    } catch (error: unknown) {
      if (!(error instanceof ServerConfigError)) {
        throw error
      }
      capturedError = error
    }

    expect(capturedError).toEqual(new ServerConfigError(["SERVER_PORT"]))
    expect(capturedError).toBeInstanceOf(ServerConfigError)
    if (capturedError instanceof ServerConfigError) {
      expect(capturedError.message).not.toContain(privateValue)
    }
  })

  it.each(["https://studio.test/path", "ftp://studio.test"])(
    "rejects a trusted-origin value that is not an HTTP origin: %s",
    (trustedOrigin) => {
      expect(() =>
        parseServerConfig({
          AUTH_BASE_URL: "http://127.0.0.1:8787",
          AUTH_SECRET: "test-secret-with-at-least-thirty-two-characters",
          DATABASE_PATH: "data/studio.sqlite",
          SERVER_HOST: "127.0.0.1",
          SERVER_PORT: "8787",
          TRUSTED_ORIGINS: trustedOrigin,
          TRUST_PROXY: "0",
        }),
      ).toThrow(new ServerConfigError(["TRUSTED_ORIGINS"]))
    },
  )
})
