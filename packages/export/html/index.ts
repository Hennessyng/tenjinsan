import { createHash } from "node:crypto"
import { PublicationRevision } from "@reading-studio/contracts"
import { readerDocument } from "@reading-studio/reader"
import { html, raw } from "hono/html"
import { type AssetResolver, embedAssets } from "./assets.ts"
import { exportRuntime, threeLicense } from "./bundle.ts"

export { type AssetResolver, ExportAssetError } from "./assets.ts"

export async function exportHtml(input: unknown, resolveAsset?: AssetResolver): Promise<string> {
  const { projection } = PublicationRevision.parse(input)
  const spatial = projection.sections.some((section) =>
    section.scenes.some(
      (scene) => scene.kind === "perspective-3d" || scene.kind === "spatial-layers-3d",
    ),
  )
  const runtime = exportRuntime(spatial)
  const hash = createHash("sha256").update(runtime).digest("base64")
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`
  const assets = await embedAssets(projection, resolveAsset)
  // JSON remains data even inside HTML's raw-text script parser.
  const data = JSON.stringify(projection)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
  const document = await readerDocument(projection, {
    head: html`<meta http-equiv="Content-Security-Policy" content="${csp}">${assets.head}<style>.practice .practice-feedback{display:block!important}</style>`,
    appendix: html`${assets.content}${spatial ? html`<section class="sources" id="export-licenses"><h2>Third-party licenses / ライセンス</h2><h3>Three.js (MIT)</h3><p style="white-space:pre-wrap">${threeLicense()}</p></section>` : html``}`,
    scripts: html`<script type="application/json" id="publication-data">${raw(data)}</script><script data-export-runtime>${raw(runtime)}</script>`,
    footer: html`<p><span lang="en">Reviewed publication · self-contained offline copy</span> / <span lang="ja">確認済み公開版・オフライン用</span></p>`,
  })
  return document.toString()
}
