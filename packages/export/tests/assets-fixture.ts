import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { PublicationProjection } from "@reading-studio/contracts"
import { exportProjection } from "./fixture.ts"

const font = readFileSync(new URL("./abel-latin.woff2", import.meta.url))
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
)
export const assetBytes = new Map(
  [font, image].map((bytes) => [createHash("sha256").update(bytes).digest("hex"), bytes]),
)
export const assetProjection = PublicationProjection.parse({
  ...exportProjection,
  assets: [
    {
      id: "font",
      contentHash: createHash("sha256").update(font).digest("hex"),
      mediaType: "font/woff2",
      alt: { en: "Abel font", ja: "Abel フォント" },
      license: readFileSync(new URL("./Abel-OFL.txt", import.meta.url), "utf8"),
    },
    {
      id: "image",
      contentHash: createHash("sha256").update(image).digest("hex"),
      mediaType: "image/png",
      alt: { en: "Synthetic single pixel", ja: "検証用の一画素" },
      license: "CC0 synthetic test image",
    },
  ],
})
export async function resolveFixtureAsset(hash: string): Promise<Uint8Array> {
  return assetBytes.get(hash) ?? new Uint8Array()
}
