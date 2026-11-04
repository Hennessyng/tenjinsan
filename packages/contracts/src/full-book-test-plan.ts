import { validBatchPartition } from "./batched-source.ts"
import { WindowOriginal } from "./coverage-verification.ts"
import {
  FullBookNodeId,
  FullBookTestError,
  FullBookTestInput,
  type FullBookTestNode,
  FullBookTestPlan,
} from "./full-book-test-contract.ts"
import { contentDigest } from "./identity.ts"
import { assertNever } from "./primitives.ts"

export function planFullBookTest(value: unknown): FullBookTestPlan {
  const input = FullBookTestInput.parse(value)
  const blocks = input.normalization.resources.flatMap((resource) => {
    switch (resource.status) {
      case "excluded":
        return []
      case "included":
        return resource.blocks.map((block) => ({ resource, block }))
      default:
        return assertNever(resource)
    }
  })
  const selected = input.groups.flatMap((group) => group.blockIds)
  if (
    new Set(input.groups.map((group) => group.id)).size !== input.groups.length ||
    JSON.stringify(selected) !== JSON.stringify(blocks.map(({ block }) => block.id))
  )
    throw new FullBookTestError("source")
  const originals = blocks.flatMap(({ resource, block }) =>
    block.text.length === 0
      ? []
      : [
          WindowOriginal.parse({
            editionId: input.normalization.editionId,
            normalizationRevisionId: input.normalization.id,
            resourcePath: resource.path,
            blockId: block.id,
            start: 0,
            end: block.text.length,
            originalFragment: block.text,
            ...(block.pageLabel ? { pageLabel: block.pageLabel } : {}),
          }),
        ],
  )
  if (!validBatchPartition(originals, input.windows)) throw new FullBookTestError("source")

  const { policy } = input
  const findingBatches = Math.ceil(policy.maxFindings / policy.findingsPerBatch)
  let width = input.windows.length,
    reductions = 0,
    levels = 0
  do {
    width = Math.ceil(width / policy.fanout)
    reductions += width
    levels++
  } while (width > 1)
  const nodeCount =
    2 * input.windows.length + reductions + (input.windows.length + 1) * findingBatches
  if (
    levels > policy.maxLevels ||
    nodeCount > policy.maxNodes ||
    nodeCount * 2 > policy.maxAttempts
  )
    throw new FullBookTestError("budget")

  const nodes: FullBookTestNode[] = []
  const append = (node: Omit<FullBookTestNode, "id">) => {
    const id = FullBookNodeId.parse(`fb-${nodes.length}`)
    nodes.push({ id, ...node })
    return id
  }
  const maps = input.windows.map((_, window) =>
    append({
      kind: "map",
      children: [],
      window,
      batch: null,
      level: 0,
    }),
  )
  let layer = maps,
    level = 0
  do {
    level++
    const next: FullBookNodeId[] = []
    for (let index = 0; index < layer.length; index += policy.fanout)
      next.push(
        append({
          kind: "reduce",
          children: layer.slice(index, index + policy.fanout),
          window: null,
          batch: null,
          level,
        }),
      )
    layer = next
  } while (layer.length > 1)
  const root = layer[0]
  if (!root) throw new FullBookTestError("graph")
  maps.forEach((map, window) => {
    append({
      kind: "map-check",
      children: [map],
      window,
      batch: null,
      level: level + 1,
    })
  })
  maps.forEach((_, window) => {
    for (let batch = 0; batch < findingBatches; batch++)
      append({ kind: "final-check", children: [root], window, batch, level: level + 1 })
  })
  for (let batch = 0; batch < findingBatches; batch++)
    append({ kind: "citation-check", children: [root], window: null, batch, level: level + 1 })
  return FullBookTestPlan.parse({
    version: input.version,
    purpose: input.purpose,
    routeEvidence: input.routeEvidence,
    inputHash: contentDigest(JSON.stringify(input)),
    nodes,
    root,
    findingBatches,
    maxAttempts: nodeCount * policy.attemptsPerNode,
  })
}

export function validateFullBookTestPlan(input: unknown, value: unknown): FullBookTestPlan {
  const plan = FullBookTestPlan.parse(value)
  if (JSON.stringify(planFullBookTest(input)) !== JSON.stringify(plan))
    throw new FullBookTestError("graph")
  return plan
}
