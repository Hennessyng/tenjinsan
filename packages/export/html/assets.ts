import { createHash } from "node:crypto"
import type { PublicationProjection } from "@reading-studio/contracts"
import { html, raw } from "hono/html"

export type AssetResolver = (hash: string) => Promise<Uint8Array>

export class ExportAssetError extends Error {
  override readonly name = "ExportAssetError"
  constructor(
    readonly assetId: string,
    readonly reason: "missing" | "digest" | "format",
  ) {
    super(`Export asset ${assetId}: ${reason}`)
  }
}

export async function embedAssets(projection: PublicationProjection, resolve?: AssetResolver) {
  const entries = await Promise.all(
    projection.assets.map(async (asset, index) => {
      if (!resolve) throw new ExportAssetError(asset.id, "missing")
      // Snapshot resolver bytes before hashing, so later mutation cannot replace approved content.
      const bytes = Buffer.from(await resolve(asset.contentHash))
      if (createHash("sha256").update(bytes).digest("hex") !== asset.contentHash) {
        throw new ExportAssetError(asset.id, "digest")
      }
      let valid: boolean
      switch (asset.mediaType) {
        case "image/png":
          valid = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
          break
        case "image/jpeg":
          valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          break
        case "image/webp":
          valid =
            bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
          break
        case "font/woff2":
          valid = bytes.toString("ascii", 0, 4) === "wOF2"
          break
        default: {
          const exhaustive: never = asset.mediaType
          return exhaustive
        }
      }
      if (!valid) throw new ExportAssetError(asset.id, "format")
      const uri = `data:${asset.mediaType};base64,${bytes.toString("base64")}`
      return asset.mediaType === "font/woff2"
        ? {
            style: `@font-face{font-family:ExportFont${index};src:url("${uri}") format("woff2");font-display:swap;}`,
            content: html``,
            family: `ExportFont${index}`,
          }
        : {
            style: "",
            content: html`<figure class="sources"><img style="max-width:100%;height:auto" src="${uri}" alt="${asset.alt.en} / ${asset.alt.ja}"><figcaption><span lang="en">${asset.alt.en}</span> / <span lang="ja">${asset.alt.ja}</span><p>${asset.license}</p></figcaption></figure>`,
            family: "",
          }
    }),
  )
  const families = entries.map((entry) => entry.family).filter(Boolean)
  const style =
    entries.map((entry) => entry.style).join("") +
    (families.length ? `body{font-family:${families.join(",")},var(--font-body);}` : "")
  return {
    head: html`<style>${raw(style)}</style>`,
    content: html`${entries.map((entry) => entry.content)}`,
  }
}
