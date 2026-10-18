import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { englishCatalog as EN } from "@reading-studio/contracts/i18n"
import { build } from "vite"
import { expect, it } from "vitest"
import { type StartupCatalog, startupPlugin } from "./startup.ts"

async function fixtureBuild(catalog: StartupCatalog): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ten19-startup-"))
  try {
    await mkdir(join(root, "src"))
    await writeFile(
      join(root, "index.html"),
      await readFile(new URL("../../index.html", import.meta.url)),
    )
    await writeFile(join(root, "src/main.tsx"), 'document.documentElement.dataset.started = "true"')
    await build({
      root,
      configFile: false,
      envFile: false,
      logLevel: "silent",
      plugins: [startupPlugin(catalog)],
      build: { outDir: "dist" },
    })
    return await readFile(join(root, "dist/index.html"), "utf8")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it("builds English startup and no-script UI from the catalog without restoring login", async () => {
  // Given / When
  const result = await fixtureBuild(EN)
  // Then
  expect(result).toContain(`<title>${EN["startup.title"]}</title>`)
  expect(result).toContain(EN["startup.loading"])
  expect(result).toContain(EN["startup.noscript.body"])
  expect(result).not.toContain('href="/login"')
  expect(result).not.toContain("__UI_")
})

it("rebuilds changed fixture-catalog values with escaped HTML and no edits to owner dictionaries", async () => {
  // Given
  const catalog: StartupCatalog = {
    ...EN,
    "startup.title": "Fixture <title>",
    "startup.description": 'Fixture "description"',
    "startup.loading": "Fixture loading",
    "startup.noscript.body": "Fixture <body>",
  }
  const originalTitle = EN["startup.title"]
  // When
  const result = await fixtureBuild(catalog)
  // Then
  expect(result).toContain("<title>Fixture &lt;title&gt;</title>")
  expect(result).toContain("Fixture &quot;description&quot;")
  expect(result).toContain("Fixture loading")
  expect(result).toContain("Fixture &lt;body&gt;")
  expect(EN["startup.title"]).toBe(originalTitle)
})
