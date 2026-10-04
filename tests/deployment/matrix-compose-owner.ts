import { spawnSync } from "node:child_process"
import { workspaceRoot } from "./local-fixture.ts"

export function provisionComposeMatrixOwner(
  prefix: readonly string[],
  environment: NodeJS.ProcessEnv,
  destination: boolean,
): void {
  const result = spawnSync(
    "expect",
    [
      "tests/deployment/owner-tty-fixture.exp",
      ...(destination ? ["--destination"] : []),
      "docker",
      ...prefix,
      "run",
      "--rm",
      "--no-deps",
      "api",
      "node",
      "--experimental-transform-types",
      "scripts/owner.ts",
    ],
    { cwd: workspaceRoot, env: environment, encoding: "utf8", timeout: 120_000 },
  )
  if (result.status !== 0)
    throw new TypeError(`Owner TTY provision failed (${result.status ?? result.signal})`)
}
