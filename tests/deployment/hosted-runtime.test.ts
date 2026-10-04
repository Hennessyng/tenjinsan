import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, it } from "vitest"
import { z } from "zod"

const root = resolve(import.meta.dirname, "../..")
const environment = {
  ...process.env,
  CANONICAL_ORIGIN: "https://localhost",
  AUTH_SECRET: "hosted-test-secret-at-least-thirty-two-characters",
  PROXY_BIND: "127.0.0.1",
  HTTP_PORT: "0",
  HTTPS_PORT: "0",
}

it("preserves private data and owner sessions across a hosted container replacement", () => {
  // Given fresh project-scoped volumes, non-root images and a local HTTPS origin.
  const project = `hosted-${randomUUID().slice(0, 8)}`
  const directory = mkdtempSync(join(tmpdir(), "reading-hosted-"))
  const args = ["compose", "-p", project, "-f", "deploy/compose.yml"]
  const compose = (command: readonly string[]): string =>
    execFileSync("docker", [...args, ...command], {
      cwd: root,
      env: environment,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
    }).trim()
  const execute = (service: string, code: string): string =>
    compose([
      "exec",
      "-T",
      service,
      "node",
      "--experimental-transform-types",
      "--input-type=module",
      "-e",
      code,
    ])
  try {
    compose(["build"])
    for (const origin of ["http://localhost", "https://localhost/path"]) {
      const result = spawnSync(
        "docker",
        [...args, "run", "--rm", "--no-deps", "-e", `AUTH_BASE_URL=${origin}`, "api", "true"],
        {
          cwd: root,
          env: environment,
          encoding: "utf8",
          timeout: 30_000,
        },
      )
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain("ServerConfigError")
    }
    const shortSecret = spawnSync(
      "docker",
      [...args, "run", "--rm", "--no-deps", "-e", "AUTH_SECRET=short", "api", "true"],
      {
        cwd: root,
        env: environment,
        encoding: "utf8",
        timeout: 30_000,
      },
    )
    expect(shortSecret.status).not.toBe(0)
    expect(shortSecret.stderr).toContain("AUTH_SECRET")
    compose([
      "run",
      "--rm",
      "--no-deps",
      "-e",
      "OWNER_EMAIL=owner@example.test",
      "-e",
      "OWNER_NAME=Hosted Owner",
      "-e",
      "OWNER_PASSWORD=correct horse battery staple",
      "api",
      "node",
      "--experimental-transform-types",
      "apps/server/src/testing/provision-owner-fixture.ts",
    ])
    compose(["up", "-d", "--wait", "--wait-timeout", "120"])
    const proxyId = compose(["ps", "-q", "proxy"])
    execFileSync("docker", [
      "cp",
      `${proxyId}:/data/caddy/pki/authorities/local/root.crt`,
      join(directory, "ca.crt"),
    ])
    const request = (path: string, options: readonly string[] = []): string => {
      const binding = compose(["port", "proxy", "443"])
      return execFileSync(
        "curl",
        [
          "--silent",
          "--show-error",
          "--max-time",
          "10",
          "--noproxy",
          "*",
          "--cacert",
          join(directory, "ca.crt"),
          "--connect-to",
          `localhost:443:${binding}`,
          ...options,
          `https://localhost${path}`,
        ],
        { encoding: "utf8" },
      )
    }
    expect(JSON.parse(request("/health"))).toEqual({ status: "ok" })
    const login = request("/login", [
      "-D",
      "-",
      "-c",
      join(directory, "cookies"),
      "-H",
      "Origin: https://localhost",
      "--data-urlencode",
      "email=owner@example.test",
      "--data-urlencode",
      "password=correct horse battery staple",
    ])
    expect(login).toMatch(/HTTP\/\S+ 303/)
    expect(login).toMatch(/set-cookie:.*Secure/i)
    expect(request("/", ["-b", join(directory, "cookies")])).toContain('<div id="root"></div>')
    expect(
      request("/login", [
        "-o",
        "/dev/null",
        "-w",
        "%{http_code}",
        "-H",
        "Origin: https://evil.invalid",
        "--data",
        "email=owner@example.test&password=wrong",
      ]),
    ).toBe("403")
    execute(
      "api",
      "import {writeFileSync} from 'node:fs'; writeFileSync('/data/private/project.txt', 'persistent private project', {mode:0o600})",
    )
    for (const service of ["api", "worker"]) {
      expect(execute(service, "process.stdout.write(String(process.getuid()))")).toBe("1000")
      const id = compose(["ps", "-q", service])
      const bindings = execFileSync(
        "docker",
        ["inspect", "--format", "{{json .HostConfig.PortBindings}}", id],
        { encoding: "utf8" },
      )
      expect(
        z.record(z.string(), z.unknown()).nullable().parse(JSON.parse(bindings)) ?? {},
      ).toEqual({})
      expect(request("/data/studio.sqlite", ["-o", "/dev/null", "-w", "%{http_code}"])).toBe("404")
    }
    expect(request("/data/private/project.txt", ["-o", "/dev/null", "-w", "%{http_code}"])).toBe(
      "404",
    )
    const httpBinding = compose(["port", "proxy", "80"])
    const redirect = execFileSync(
      "curl",
      [
        "-sS",
        "--noproxy",
        "*",
        "-D",
        "-",
        "-o",
        "/dev/null",
        "-H",
        "Host: localhost",
        `http://${httpBinding}/login`,
      ],
      { encoding: "utf8" },
    )
    expect(redirect).toMatch(/HTTP\/\S+ 308/)
    expect(redirect).toMatch(/location: https:\/\/localhost\/login/i)

    // When the API and worker containers are replaced (not just their processes).
    compose(["up", "-d", "--force-recreate", "--wait", "--wait-timeout", "120", "api", "worker"])

    // Then the original session and private bytes survive and health remains green.
    expect(request("/", ["-b", join(directory, "cookies")])).toContain('<div id="root"></div>')
    expect(
      execute(
        "worker",
        "import {readFileSync} from 'node:fs'; process.stdout.write(readFileSync('/data/private/project.txt'))",
      ),
    ).toBe("persistent private project")
    expect(JSON.parse(request("/health"))).toEqual({ status: "ok" })
    console.info(
      "HOSTED PASS: trusted local CA; owner login/session persistence; private volume; canonical HTTPS redirect; cross-origin rejection; non-root API/worker; sandbox readiness; no API/DB/worker published ports",
    )
  } catch (error: unknown) {
    if (error instanceof Error) console.error(compose(["logs", "--no-color", "--tail", "60"]))
    throw error
  } finally {
    compose(["down", "--volumes", "--remove-orphans"])
    rmSync(directory, { recursive: true, force: true })
  }
}, 600_000)
