import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect, it } from "vitest"

const root = resolve(import.meta.dirname, "../..")
const owner = {
  OWNER_EMAIL: "owner@example.test",
  OWNER_NAME: "Fixture Owner",
  OWNER_PASSWORD: "correct horse battery staple",
}
const environment = {
  ...process.env,
  AUTH_BASE_URL: "https://localhost",
  AUTH_SECRET: "fixture-cleanup-secret-at-least-thirty-two-characters",
  CANONICAL_ORIGIN: "https://localhost",
  PROXY_BIND: "127.0.0.1",
  HTTP_PORT: "0",
  HTTPS_PORT: "0",
  ...owner,
}
const fixture = "apps/server/src/testing/provision-owner-fixture.ts"
const inspect = `import {createRequire} from 'node:module';
import {openAuthStorage} from './packages/storage/src/index.ts';
const Database=createRequire(process.cwd()+'/packages/storage/package.json')('better-sqlite3');
const path=process.env.DATABASE_PATH;
const database=new Database(path);
const lock=new Database(path+'.maintenance-lock.sqlite');
try {
  lock.exec('BEGIN EXCLUSIVE');
  const users=database.prepare('SELECT count(*) AS count FROM auth_users').get().count;
  const instances=database.prepare('SELECT count(*) AS count FROM maintenance_instances').get().count;
  console.log(JSON.stringify({users,instances,lockExclusive:true}));
} finally {lock.close();database.close()}
const storage=openAuthStorage(path);
storage.close();
storage.close();`

it("closes the native owner fixture database on success and rejected duplicate in standalone Node", () => {
  const directory = mkdtempSync(join(tmpdir(), "owner-fixture-cleanup-"))
  const databasePath = join(directory, "studio.sqlite")
  const run = () =>
    spawnSync(process.execPath, ["--experimental-transform-types", fixture], {
      cwd: root,
      env: { ...environment, DATABASE_PATH: databasePath },
      encoding: "utf8",
      timeout: 30_000,
    })
  try {
    const success = run()
    const duplicate = run()

    expect(success.status, success.stderr).toBe(0)
    expect(success.signal).toBeNull()
    expect({
      status: duplicate.status,
      signal: duplicate.signal,
      stderr: duplicate.stderr,
    }).toMatchObject({
      status: 1,
      signal: null,
    })
    expect(duplicate.stderr).toContain("OwnerAlreadyExistsError")
    const check = spawnSync(
      process.execPath,
      ["--experimental-transform-types", "--input-type=module", "-e", inspect],
      {
        cwd: root,
        env: { ...environment, DATABASE_PATH: databasePath },
        encoding: "utf8",
        timeout: 30_000,
      },
    )
    expect(check.status, check.stderr).toBe(0)
    expect(JSON.parse(check.stdout.trim())).toEqual({ users: 1, instances: 0, lockExclusive: true })
  } finally {
    rmSync(directory, { force: true, recursive: true })
  }
}, 60_000)

it("exits cleanly after provisioning in the actual hosted Node 24 container", () => {
  const project = `owner-cleanup-${randomUUID().slice(0, 8)}`
  const args = ["compose", "-p", project, "-f", "deploy/compose.yml"]
  const run = (command: readonly string[]) =>
    spawnSync("docker", [...args, ...command], {
      cwd: root,
      env: environment,
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
    })
  try {
    expect(run(["build", "api"]).status).toBe(0)
    const command = [
      "run",
      "--rm",
      "--no-deps",
      "-e",
      `OWNER_EMAIL=${owner.OWNER_EMAIL}`,
      "-e",
      `OWNER_NAME=${owner.OWNER_NAME}`,
      "-e",
      `OWNER_PASSWORD=${owner.OWNER_PASSWORD}`,
      "api",
      "node",
      "--experimental-transform-types",
      fixture,
    ]
    const success = run(command)
    const duplicate = run(command)

    expect(success.status, success.stderr).toBe(0)
    expect(success.signal).toBeNull()
    expect({
      status: duplicate.status,
      signal: duplicate.signal,
      stderr: duplicate.stderr,
    }).toMatchObject({
      status: 1,
      signal: null,
    })
    expect(duplicate.stderr).toContain("OwnerAlreadyExistsError")
    const check = run([
      "run",
      "--rm",
      "--no-deps",
      "api",
      "node",
      "--experimental-transform-types",
      "--input-type=module",
      "-e",
      inspect,
    ])
    expect(check.status, check.stderr).toBe(0)
    expect(JSON.parse(check.stdout.trim())).toEqual({ users: 1, instances: 0, lockExclusive: true })
    expect(run(["ps", "-a", "-q"]).stdout.trim()).toBe("")
  } finally {
    run(["down", "--volumes", "--remove-orphans"])
  }
}, 600_000)
