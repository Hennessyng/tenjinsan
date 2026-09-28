import { parseServerConfig, ServerConfigError } from "./config.ts"

if (process.env["HOSTED_ROLE"] === "api") {
  const config = parseServerConfig(process.env)
  const origin = new URL(config.authBaseURL)
  if (
    origin.protocol !== "https:" ||
    origin.port !== "" ||
    config.authBaseURL !== origin.origin ||
    config.trustedOrigins.length !== 1 ||
    config.trustedOrigins[0] !== origin.origin
  ) {
    throw new ServerConfigError(["CANONICAL_ORIGIN must be one HTTPS origin on port 443"])
  }
}
