import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "vite"
import { expect, it } from "vitest"
import { z } from "zod"
import { startupPlugin } from "./startup.ts"

it("rebuilds HTML, component copy and fixed reader UI from one changed disposable catalog", async () => {
  // Given
  const repo = fileURLToPath(new URL("../../../../", import.meta.url))
  const root = await mkdtemp(join(tmpdir(), "ten19-catalog-consumers-"))
  try {
    await mkdir(join(root, "src"))
    await cp(join(repo, "packages/contracts/src/i18n"), join(root, "catalog"), { recursive: true })
    await symlink(join(repo, "node_modules"), join(root, "node_modules"), "dir")
    await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }))
    const dictionary = z
      .record(z.string(), z.string())
      .parse(JSON.parse(await readFile(join(root, "catalog/EN.json"), "utf8")))
    const changed = {
      ...dictionary,
      "startup.title": "Disposable startup title",
      "interview.title": "Disposable interview title",
      "reader.skip": "Disposable reader link",
    }
    await writeFile(join(root, "catalog/EN.json"), JSON.stringify(changed))
    await writeFile(
      join(root, "index.html"),
      await readFile(new URL("../../index.html", import.meta.url)),
    )
    await writeFile(join(root, "src/main.tsx"), "export {}")
    const startup = z
      .object({
        "startup.title": z.string(),
        "startup.description": z.string(),
        "startup.loading": z.string(),
        "startup.noscript.title": z.string(),
        "startup.noscript.body": z.string(),
        "startup.noscript.link": z.string(),
      })
      .parse(changed)
    const entry = join(root, "probe.ts")
    await writeFile(
      entry,
      `import { interviewCopy } from ${JSON.stringify(join(repo, "apps/studio/src/interview/copy.ts"))};
import { fixedUi } from ${JSON.stringify(join(repo, "packages/reader/src/ui.ts"))};
export const component = interviewCopy.en.title;
export const renderer = String(await fixedUi("reader.skip", "en"));`,
    )
    // When
    await build({
      root,
      configFile: false,
      envFile: false,
      logLevel: "silent",
      plugins: [startupPlugin(startup)],
      build: { outDir: "html-dist" },
    })
    await build({
      root,
      configFile: false,
      envFile: false,
      logLevel: "silent",
      resolve: { alias: { "@reading-studio/contracts/i18n": join(root, "catalog/index.ts") } },
      build: { ssr: entry, outDir: "consumer-dist" },
    })
    const actual = z
      .object({ component: z.string(), renderer: z.string() })
      .parse(await import(pathToFileURL(join(root, "consumer-dist/probe.js")).href))
    // Then
    expect(await readFile(join(root, "html-dist/index.html"), "utf8")).toContain(
      "<title>Disposable startup title</title>",
    )
    expect(actual.component).toBe("Disposable interview title")
    expect(actual.renderer).toContain("Disposable reader link")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
