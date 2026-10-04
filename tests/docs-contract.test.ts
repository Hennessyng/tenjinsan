import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { z } from "zod"

const root = resolve(import.meta.dirname, "..")
const documents = [
  "README.md",
  "deploy/README.md",
  "docs/DEVELOPMENT.md",
  "docs/LOCAL.md",
  "docs/CONSENT-PROVIDERS.md",
  "docs/PRIVACY-SECURITY.md",
  "docs/BACKUP-RESTORE.md",
  "docs/OUTPUT-LIMITS.md",
  "docs/LICENSES.md",
  "packages/providers/README.md",
  "packages/generation/README.md",
  "apps/studio/src/outline/README.md",
  "DESIGN.md",
  "apps/studio/src/brief/README.md",
  "apps/studio/src/evidence/README.md",
  "apps/studio/src/interview/README.md",
  "apps/studio/src/publication/README.md",
  "apps/studio/src/source-viewer/README.md",
] as const

const rootScripts: Readonly<Record<string, string>> = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).scripts
const envKeys = new Set([
  ...readFileSync(resolve(root, ".env.example"), "utf8")
    .split("\n")
    .flatMap((line) => (line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1] ? [line.split("=")[0]] : [])),
  ...readFileSync(resolve(root, "deploy/.env.example"), "utf8")
    .split("\n")
    .flatMap((line) => (line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1] ? [line.split("=")[0]] : [])),
  ...[
    ...readFileSync(resolve(root, "deploy/compose.yml"), "utf8").matchAll(/\$\{([A-Z][A-Z0-9_]*)/g),
  ].map((match) => match[1]),
  ...[
    "apps/worker/scripts/providers-live-smoke.ts",
    "apps/worker/src/index.ts",
    "tests/exports/pdf.spec.ts",
  ].flatMap((file) =>
    [
      ...readFileSync(resolve(root, file), "utf8").matchAll(/process\.env\["([A-Z][A-Z0-9_]*)"\]/g),
    ].map((match) => match[1]),
  ),
])

describe("owner documentation contract", () => {
  it("rejects retired architecture and blocked-stage claims in active guides", () => {
    const active = [
      "README.md",
      "deploy/README.md",
      "packages/providers/README.md",
      "packages/generation/README.md",
      "apps/studio/src/outline/README.md",
      "DESIGN.md",
      "apps/studio/src/brief/README.md",
      "apps/studio/src/evidence/README.md",
      "apps/studio/src/interview/README.md",
      "apps/studio/src/publication/README.md",
      "apps/studio/src/source-viewer/README.md",
    ] as const
    const stale = [
      /authoring flow is served by Hono pages/i,
      /authoring pages use Hono/i,
      /React\/Vite\s+(?:studio remains|supplies) a separate shell/i,
      /no live outline adapter/i,
      /generation as blocked/i,
      /Send\s+button or run live analysis/i,
      /server-rendered setup flow/i,
      /does not forward provider keys/i,
      /section\s+generation remains unavailable/i,
      /no lesson\/evidence review UI, automatic\s+job dispatch/i,
      /no reader-context or derived-material category\s+is authorized/i,
      /native server-rendered (?:form|forms|pages)/i,
      /owner-scoped, server-rendered panel/i,
      /server renders it on the existing\s+authenticated origin/i,
      /no additional browser app, client requests/i,
      /page runs no JavaScript/i,
      /Task15 remains fixture-only/i,
      /Task18 is not implemented/i,
      /Section generation remains unavailable in Task18/i,
      /no script or animation/i,
      /no client scripts/i,
    ] as const
    for (const document of active) {
      const text = readFileSync(resolve(root, document), "utf8")
      for (const claim of stale) expect(text, `${document}: ${claim}`).not.toMatch(claim)
    }
  })

  it("keeps fixture utilities distinct from the React owner routes and offline exports", () => {
    const design = readFileSync(resolve(root, "DESIGN.md"), "utf8")
    const interview = readFileSync(resolve(root, "apps/studio/src/interview/README.md"), "utf8")
    const publication = readFileSync(resolve(root, "apps/studio/src/publication/README.md"), "utf8")
    const assets = readFileSync(resolve(root, "apps/server/src/studio-assets.ts"), "utf8")
    const renderer = readFileSync(resolve(root, "apps/server/src/publication-service.ts"), "utf8")
    expect(assets).toContain("return studioResponse(context, assets)")
    expect(interview).toMatch(/fixture.*utilit/is)
    expect(interview).toMatch(/normal.*(?:worker|pipeline)/is)
    expect(renderer).toContain("exportHtml(snapshot.publication, resolveAsset)")
    expect(design).toMatch(/React.*authoring/is)
    expect(publication).toMatch(/offline.*(?:HTML|projection)/is)
  })

  it("matches documented stage limits and controls to active source", () => {
    const providerGuide = readFileSync(resolve(root, "packages/providers/README.md"), "utf8")
    const generationGuide = readFileSync(resolve(root, "packages/generation/README.md"), "utf8")
    const deployGuide = readFileSync(resolve(root, "deploy/README.md"), "utf8")
    const adapter = readFileSync(resolve(root, "packages/providers/src/adapter.ts"), "utf8")
    const jobs = readFileSync(resolve(root, "apps/server/src/jobs.ts"), "utf8")
    const worker = readFileSync(resolve(root, "apps/worker/src/production-runtime.ts"), "utf8")
    expect(adapter).toContain("MAX_PROVIDER_REQUEST_BYTES = 32_000")
    expect(providerGuide).toMatch(/32,000.*UTF-8/s)
    expect(generationGuide).toMatch(/64.*setup/s)
    expect(worker).toContain('job.stage === "lesson"')
    expect(generationGuide).toMatch(/per-section lesson jobs/is)
    expect(jobs).toContain('app.route("/api/study-jobs", routes)')
    expect(deployGuide).toContain("/jobs")
    expect(deployGuide).toContain("maintenance-recover")
  })

  it.each(documents)("has the documented guide %s", (document) => {
    // Given the installation guides named in the owner documentation index.
    // When the guide is resolved relative to the workspace.
    // Then the guide exists at that public path.
    expect(existsSync(resolve(root, document))).toBe(true)
  })

  it("references only existing root scripts and TypeScript CLI entrypoints", () => {
    // Given the owner-facing installation and operations guides.
    const text = documents
      .filter((document) => existsSync(resolve(root, document)))
      .map((document) => readFileSync(resolve(root, document), "utf8"))
      .join("\n")
    // When command references are extracted from their shell examples and prose.
    const scripts = [...text.matchAll(/\bbun run (?!--cwd\b)([\w:-]+)/g)].map((match) => match[1])
    const entrypoints = [...text.matchAll(/\b(?:node|bun) (?:--[\w=-]+ )*([\w/-]+\.ts)\b/g)].map(
      (match) => match[1],
    )
    // Then each named command has an actual executable definition.
    expect(scripts.length).toBeGreaterThan(0)
    expect(scripts.filter((script) => script && !(script in rootScripts))).toEqual([])
    expect(
      entrypoints.filter((entrypoint) => entrypoint && !existsSync(resolve(root, entrypoint))),
    ).toEqual([])
  })

  it("resolves referenced setup keys against runtime or deployment definitions", () => {
    // Given the owner-facing guides and their environment-key references.
    const text = documents
      .map((document) => readFileSync(resolve(root, document), "utf8"))
      .join("\n")
    // When backtick-quoted configuration names are extracted.
    const keys = [...text.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`/g)]
      .map((match) => match[1])
      .filter((key) => key !== "LOCAL_EVENT" && key !== "PUBLICATION_RENDERER")
    // Then each key is defined by an env template, Compose or a live script.
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((key) => key && !envKeys.has(key))).toEqual([])
  })

  it("documents only CLI-accepted library operations and a TTY recovery path", () => {
    // Given the published owner commands and the executable CLI usage.
    const guide = readFileSync(resolve(root, "docs/BACKUP-RESTORE.md"), "utf8")
    const usage = execFileSync("bun", ["run", "library", "--help"], {
      cwd: root,
      encoding: "utf8",
    })
    // When an operator follows each published library command.
    const commands = [
      ...guide.matchAll(
        /\bbun run library (backup|restore|delete-project|delete-source|maintenance-recover)([^\n`]*)/g,
      ),
    ]
    // Then each operation exists and no rejected option is passed.
    expect(commands.map((match) => match[1])).toEqual(
      expect.arrayContaining([
        "backup",
        "restore",
        "delete-project",
        "delete-source",
        "maintenance-recover",
      ]),
    )
    for (const command of commands) {
      expect(usage).toContain(command[1])
      expect(command[2]).not.toContain("--quiesced")
    }
  })

  it("publishes an executable hosted library command in the installed image", () => {
    // Given the hosted operator guide and image build recipe.
    const guide = readFileSync(resolve(root, "deploy/README.md"), "utf8")
    const image = readFileSync(resolve(root, "deploy/Dockerfile"), "utf8")
    // When the documented hosted library command is inspected.
    const command = guide.match(
      /docker compose --env-file deploy\/\.env -f deploy\/compose\.yml exec -it api\s*\\?\s*node --experimental-transform-types scripts\/library\.ts/,
    )
    // Then the script and encryption tool are present in the image.
    expect(command).not.toBeNull()
    expect(image).toContain("COPY scripts/library.ts ./scripts/library.ts")
    expect(image).toMatch(/apt-get install[^\n]*age/)
  })

  it("keeps the standard Compose runtime synthetic-free while forwarding both provider keys", () => {
    // Given only the standard production Compose definition.
    const output = execFileSync(
      "docker",
      ["compose", "-f", "deploy/compose.yml", "config", "--format", "json"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          CANONICAL_ORIGIN: "https://localhost",
          AUTH_SECRET: "synthetic-free-compose-contract-secret",
          OPENAI_API_KEY: "wire-openai-contract-only",
          ANTHROPIC_API_KEY: "wire-anthropic-contract-only",
          STUDIO_SYNTHETIC_TEST_MODE: "enabled",
        },
      },
    )
    // When Compose resolves the effective container environments.
    const config = z
      .object({
        services: z.record(z.string(), z.object({ environment: z.record(z.string(), z.string()) })),
      })
      .parse(JSON.parse(output))
    // Then even an ambient test flag is not forwarded, while server-side keys are.
    for (const role of ["api", "worker"]) {
      const environment = config.services[role]?.environment
      expect(environment).toBeDefined()
      expect(environment).not.toHaveProperty("STUDIO_SYNTHETIC_TEST_MODE")
      expect(environment).toHaveProperty("OPENAI_API_KEY", "wire-openai-contract-only")
      expect(environment).toHaveProperty("ANTHROPIC_API_KEY", "wire-anthropic-contract-only")
    }
  })

  it("enables synthetic processing only with the dedicated Compose test overlay", () => {
    // Given a separate test-only overlay on the normal Compose definition.
    const output = execFileSync(
      "docker",
      [
        "compose",
        "-f",
        "deploy/compose.yml",
        "-f",
        "tests/deployment/compose-synthetic.yml",
        "config",
        "--format",
        "json",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          CANONICAL_ORIGIN: "https://localhost",
          AUTH_SECRET: "synthetic-overlay-contract-secret-32-chars",
        },
      },
    )
    // When Compose resolves the test services.
    const config = z
      .object({
        services: z.record(z.string(), z.object({ environment: z.record(z.string(), z.string()) })),
      })
      .parse(JSON.parse(output))
    // Then both test services opt in explicitly.
    for (const role of ["api", "worker"])
      expect(config.services[role]?.environment).toHaveProperty(
        "STUDIO_SYNTHETIC_TEST_MODE",
        "enabled",
      )
  })
})
