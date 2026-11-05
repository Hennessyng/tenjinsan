export { installedPdfPackages } from "./dependency-tree.ts"

export function assertWasmOnlyPackages(names: readonly string[]): void {
  for (const name of names) {
    const match = /(?:^|\/)(@embedpdf\/engine-runtime-([^/@]+))(?:@[^/]*)?$/u.exec(name)
    if (match && match[2] !== "wasm32") throw new TypeError(`excluded PDF runtime package: ${name}`)
  }
}
