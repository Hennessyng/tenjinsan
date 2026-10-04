import { PerspectiveCamera, Vector3 } from "three"

export const cameraPositions = [
  [0, 0, 8],
  [8, 0, 0],
  [0, 8, 0],
  [6, 5, 7],
] as const
export type Block = {
  readonly center: readonly [number, number, number]
  readonly size: readonly [number, number, number]
}

export function markerPosition(index: number, count: number) {
  return { x: 24, y: 48 + index * (224 / Math.max(1, count - 1)) }
}

export function spatialCamera(view: number) {
  const camera = new PerspectiveCamera(45, 1, 0.1, 100)
  const position = cameraPositions[view % cameraPositions.length] ?? cameraPositions[0]
  camera.position.set(position[0], position[1], position[2])
  if (view % cameraPositions.length === 2) camera.up.set(0, 0, -1)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  return camera
}

export function spatialBlocks(layerCount: number): readonly Block[] {
  if (layerCount === 0)
    return [
      { center: [-0.45, 0, 0.9], size: [1.4, 1.8, 0.5] },
      { center: [0.45, 0, -0.9], size: [1.4, 1.8, 0.5] },
    ]
  return Array.from({ length: layerCount }, (_, index) => ({
    center: [0, (index - (layerCount - 1) / 2) * (4 / layerCount), 0] as const,
    size: [2.8, Math.min(0.35, 2 / layerCount), 2] as const,
  }))
}

export function projectedPoint(point: readonly [number, number, number], view: number) {
  const projected = new Vector3(...point).project(spatialCamera(view))
  return { x: (projected.x + 1) * 160, y: (1 - projected.y) * 160, depth: projected.z }
}

export function projectedFaces(block: Block, view: number) {
  const vertices = [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) =>
      [-1, 1].map((z) =>
        projectedPoint(
          [
            block.center[0] + (x * block.size[0]) / 2,
            block.center[1] + (y * block.size[1]) / 2,
            block.center[2] + (z * block.size[2]) / 2,
          ],
          view,
        ),
      ),
    ),
  )
  return [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ]
    .map((face) => face.flatMap((index) => vertices[index] ?? []))
    .sort(
      (left, right) =>
        right.reduce((sum, p) => sum + p.depth, 0) - left.reduce((sum, p) => sum + p.depth, 0),
    )
    .map((face) => face.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" "))
}
