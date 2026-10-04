import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshLambertMaterial,
  Scene,
  WebGLRenderer,
} from "three"
import { markerPosition, projectedPoint, spatialBlocks, spatialCamera } from "./spatial-model.ts"

export function createSpatialRenderer(figure: HTMLElement) {
  const canvas = figure.querySelector("canvas")
  const count = Number(figure.dataset["layerCount"])
  if (!canvas || !Number.isInteger(count) || count < 0 || count > 12) return null
  const context = canvas.getContext("webgl2", { alpha: true, antialias: true })
  if (!context) return null
  let renderer: WebGLRenderer
  try {
    renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true })
  } catch (error) {
    context.getExtension("WEBGL_lose_context")?.loseContext()
    if (error instanceof Error) return null
    throw error
  }
  const colors = getComputedStyle(figure)
  const scene = new Scene()
  scene.add(new AmbientLight(colors.getPropertyValue("--color-paper").trim(), 1))
  const light = new DirectionalLight(colors.getPropertyValue("--color-paper-raised").trim(), 1.5)
  light.position.set(3, 5, 6)
  scene.add(light)
  const blocks = spatialBlocks(count)
  const meshes = blocks.map((block, index) => {
    const material = new MeshLambertMaterial({
      color: colors.getPropertyValue(index % 2 ? "--color-coral" : "--color-green-soft").trim(),
    })
    const mesh = new Mesh(new BoxGeometry(...block.size), material)
    mesh.position.set(...block.center)
    scene.add(mesh)
    return mesh
  })
  const markers = [...figure.querySelectorAll<HTMLElement>("[data-marker]")]
  const leaders = [...figure.querySelectorAll<SVGLineElement>("[data-leader]")]
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  return {
    render(view: number, selected: number) {
      const size = Math.max(1, Math.min(640, canvas.parentElement?.clientWidth ?? 320))
      renderer.setSize(size, size, false)
      meshes.forEach((mesh, index) => {
        mesh.material.emissive.set(
          selected === index ? colors.getPropertyValue("--color-green").trim() : 0,
        )
        mesh.material.emissiveIntensity = 0.25
      })
      renderer.render(scene, spatialCamera(view))
      blocks.forEach((block, index) => {
        const marker = markers[index]
        if (!marker) return
        const point = projectedPoint(block.center, view)
        const position = markerPosition(index, blocks.length)
        marker.style.left = `${position.x / 3.2}%`
        marker.style.top = `${position.y / 3.2}%`
        const leader = leaders[index]
        leader?.setAttribute("x1", String(position.x))
        leader?.setAttribute("y1", String(position.y))
        leader?.setAttribute("x2", String(point.x))
        leader?.setAttribute("y2", String(point.y))
      })
      figure.dataset["renderCount"] = String(Number(figure.dataset["renderCount"] ?? 0) + 1)
    },
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
      scene.clear()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
