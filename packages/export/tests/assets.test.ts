import { createHash } from "node:crypto"
import { Window } from "happy-dom"
import { expect, it } from "vitest"
import { exportHtml } from "../html/index.ts"
import { assetBytes, assetProjection, resolveFixtureAsset } from "./assets-fixture.ts"
import { approved, exportProjection } from "./fixture.ts"

it("embeds only approved bytes and their licenses when assets are supplied", async () => {
  const output = await exportHtml(approved(assetProjection), resolveFixtureAsset)
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } })
  window.document.write(output)
  expect(window.document.querySelectorAll('img[src^="data:image/png;base64,"]')).toHaveLength(1)
  expect(output).toContain("data:font/woff2;base64,")
  expect(window.document.body.textContent).toContain("SIL OPEN FONT LICENSE")
  for (const [, bytes] of assetBytes) {
    expect(output).toContain(bytes.toString("base64"))
  }
  for (const match of output.matchAll(/data:[^;]+;base64,([A-Za-z0-9+/=]+)/g)) {
    const decoded = Buffer.from(match[1] ?? "", "base64")
    expect(assetBytes.has(createHash("sha256").update(decoded).digest("hex"))).toBe(true)
    expect(decoded.toString("utf8")).not.toContain("PRIVATE_")
  }
  await window.happyDOM.close()
})

it("rejects missing assets rather than falling back to remote loads", async () => {
  await expect(exportHtml(approved(assetProjection))).rejects.toThrow("missing")
})

it("rejects unapproved resolver bytes when their digest differs", async () => {
  await expect(
    exportHtml(approved(assetProjection), async () => Buffer.from("PRIVATE_ASSET_CANARY")),
  ).rejects.toThrow("digest")
})

it("rejects executable asset bytes even when their digest is approved as an image", async () => {
  const bytes = Buffer.from('<svg onload="alert(1)"></svg>')
  const revision = approved({
    ...exportProjection,
    assets: [
      {
        id: "spoof",
        mediaType: "image/png",
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        alt: { en: "Image", ja: "画像" },
        license: "CC0",
      },
    ],
  })
  await expect(exportHtml(revision, async () => bytes)).rejects.toThrow("format")
})

it("omits Three.js when the approved lesson contains only SVG scenes", async () => {
  const projection = {
    ...exportProjection,
    sections: exportProjection.sections.map((section) => ({
      ...section,
      scenes: section.scenes.slice(0, 4),
    })),
  }
  const output = await exportHtml(approved(projection))
  expect(output).not.toContain("Three.js")
  expect(output.length).toBeLessThan(100_000)
})
