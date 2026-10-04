import { SceneSpec } from "@reading-studio/contracts"
import { describe, expect, it } from "vitest"
import { readerDocument } from "../src/index.ts"
import { layerInventory, spatialInventory, spatialLesson } from "./spatial-fixture.ts"

describe("selective spatial scenes", () => {
  it("supplies every independent viewpoint and layer as labelled static geometry", async () => {
    // Given
    const expected = spatialInventory
    // When
    const document = String(await readerDocument(spatialLesson))
    // Then
    expect(document.match(/data-three-scene=/g)).toHaveLength(2)
    for (const scene of ["perspective", "spatial"])
      for (const view of expected) {
        expect(document).toContain(`data-static-view="${scene}:viewpoint:${view.id}"`)
        expect(document).toContain(view.label.en)
        expect(document).toContain(view.label.ja)
      }
    for (const layer of layerInventory)
      expect(document).toContain(`data-layer="spatial:layer:${layer.id}"`)
    expect(document).toContain("data-three-runtime")
  })
  it("rejects executable and unbounded caller renderer configuration", () => {
    // Given
    const scene = spatialLesson.sections[0]?.scenes[0]
    // When / Then
    for (const extra of [
      { shader: "void main(){}" },
      { code: "alert(1)" },
      { camera: [Infinity, 0, 0] },
      { asset: "https://cdn.example/model" },
    ])
      expect(SceneSpec.safeParse({ ...scene, ...extra }).success).toBe(false)
  })
})
