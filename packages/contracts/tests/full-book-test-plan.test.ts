import { expect, it } from "vitest"
import { WindowOriginal } from "../src/coverage-verification.ts"
import {
  FullBookNodeId,
  FullBookTestError,
  FullBookTestInput,
} from "../src/full-book-test-contract.ts"
import { planFullBookTest, validateFullBookTestPlan } from "../src/full-book-test-plan.ts"
import { assertNever, NormalizationRevisionId } from "../src/primitives.ts"

function fullBookInput() {
  const originals = Array.from({ length: 5 }, (_, index) =>
    WindowOriginal.parse({
      editionId: "edition",
      normalizationRevisionId: "normalization",
      resourcePath: "book.txt",
      blockId: `block-${index}`,
      start: 0,
      end: 3,
      originalFragment: "a😀",
    }),
  )
  return FullBookTestInput.parse({
    version: "full-book-test-1",
    purpose: "experimental-analysis-only",
    routeEvidence: "experimental-app-guards-not-live-certificate",
    normalization: {
      id: "normalization",
      editionId: "edition",
      editionHash: "a".repeat(64),
      parserVersion: "test-1",
      normalizerVersion: "test-1",
      coverage: "partial",
      resources: [
        {
          path: "book.txt",
          role: "main-chapter",
          status: "included",
          blocks: [
            ...originals.map((span) => ({ id: span.blockId, text: span.originalFragment })),
            { id: "anchor", text: "" },
          ],
        },
      ],
      omissions: [{ path: "image.png", reason: "image removed" }],
    },
    groups: [
      { id: "g1", blockIds: ["block-0", "block-1"] },
      { id: "g2", blockIds: ["block-2", "block-3", "block-4", "anchor"] },
    ],
    windows: originals.map((span) => [span]),
    policy: {
      fanout: 2,
      maxLevels: 3,
      maxFindings: 3,
      findingsPerBatch: 2,
      maxNodes: 100,
      maxAttempts: 100,
      maxAppBytes: 32_000,
      maxOutputBytes: 16_000,
      attemptsPerNode: 2,
    },
  })
}

it("precommits a finite hierarchy and all original-window checks before any outputs exist", () => {
  // Given five windows, binary fanout and two finding batches.
  const input = fullBookInput()
  // When the complete source is planned.
  const plan = planFullBookTest(input)
  // Then 5 maps + 6 reductions + 5 own checks + 10 final checks + 2 citation checks.
  expect(plan.nodes).toHaveLength(28)
  expect(plan.maxAttempts).toBe(56)
  expect(
    plan.nodes
      .filter((node) => node.kind === "final-check")
      .map((node) => [node.window, node.batch]),
  ).toEqual([
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
    [2, 0],
    [2, 1],
    [3, 0],
    [3, 1],
    [4, 0],
    [4, 1],
  ])
})

it.each(["lost", "duplicate", "order", "foreign", "text", "unicode"])(
  "refuses a %s source partition instead of claiming coverage",
  (damage) => {
    // Given an otherwise valid, complete input.
    const input = fullBookInput(),
      windows = input.windows.map((window) => [...window])
    const first = windows[0]?.[0]
    if (!first) throw new TypeError("Missing fixture")
    switch (damage) {
      case "lost":
        windows.pop()
        break
      case "duplicate":
        windows.push([first])
        break
      case "order":
        windows.reverse()
        break
      case "foreign":
        windows[0] = [
          { ...first, normalizationRevisionId: NormalizationRevisionId.parse("foreign") },
        ]
        break
      case "text":
        windows[0] = [{ ...first, originalFragment: "xyz" }]
        break
      case "unicode":
        windows[0] = [{ ...first, end: 2, originalFragment: "a\ud83d" }]
        break
      default:
        throw new TypeError("Unknown fixture")
    }
    // When/Then planning refuses rather than dropping or repairing source.
    expect(() => planFullBookTest({ ...input, windows })).toThrow()
  },
)

it.each([{ maxLevels: 2 }, { maxAttempts: 55 }, { maxNodes: 27 }])(
  "refuses a topology outside the declared finite planner bounds %j",
  (policy) => {
    // Given a complete source but insufficient finite bounds.
    const input = fullBookInput()
    // When/Then there is no postconsent growth.
    expect(() => planFullBookTest({ ...input, policy: { ...input.policy, ...policy } })).toThrow(
      new FullBookTestError("budget"),
    )
  },
)

it.each(["lost-child", "cycle", "duplicate", "order", "foreign"])(
  "rejects %s mutations of a committed graph",
  (damage) => {
    // Given a canonical plan.
    const input = fullBookInput(),
      plan = planFullBookTest(input)
    const nodes = plan.nodes.map((node) => ({ ...node, children: [...node.children] }))
    const reduction = nodes.find((node) => node.kind === "reduce")
    if (!reduction) throw new TypeError("Missing reduction")
    switch (damage) {
      case "lost-child":
        reduction.children.pop()
        break
      case "cycle":
        reduction.children = [reduction.id]
        break
      case "duplicate":
        nodes.push(reduction)
        break
      case "order":
        nodes.reverse()
        break
      case "foreign":
        reduction.children = [FullBookNodeId.parse("fb-9999")]
        break
      default:
        throw new TypeError("Unknown fixture")
    }
    // When/Then even schema-valid graph corruption fails closed.
    expect(() => validateFullBookTestPlan(input, { ...plan, nodes })).toThrow(
      new FullBookTestError("graph"),
    )
  },
)

it.each(["anchor", "omission", "group", "edition"])(
  "binds plans to unchanged %s metadata",
  (kind) => {
    // Given a committed source plan.
    const input = fullBookInput(),
      plan = planFullBookTest(input)
    // When otherwise valid source metadata changes.
    let changed: unknown
    switch (kind) {
      case "omission":
        changed = { ...input, normalization: { ...input.normalization, omissions: [] } }
        break
      case "anchor":
        changed = {
          ...input,
          normalization: {
            ...input.normalization,
            resources: input.normalization.resources.map((resource) => {
              switch (resource.status) {
                case "included":
                  return {
                    ...resource,
                    blocks: resource.blocks.map((block) =>
                      block.id === "anchor"
                        ? { ...block, originalFragment: "retained-anchor" }
                        : block,
                    ),
                  }
                case "excluded":
                  return resource
                default:
                  return assertNever(resource)
              }
            }),
          },
        }
        break
      case "group":
        changed = {
          ...input,
          groups: input.groups.map((group) => ({ ...group, id: `${group.id}-new` })),
        }
        break
      case "edition":
        changed = {
          ...input,
          normalization: { ...input.normalization, editionHash: "b".repeat(64) },
        }
        break
      default:
        throw new TypeError("Unknown fixture")
    }
    // Then the previous commitment cannot be reused.
    expect(() => validateFullBookTestPlan(changed, plan)).toThrow(new FullBookTestError("graph"))
  },
)

it("accepts adjacent multi-group windows while preserving scalar-safe split blocks", () => {
  // Given all five blocks in one window crossing a group boundary, with one block split safely.
  const input = fullBookInput(),
    originals = input.windows.flat(),
    first = originals[0]
  if (!first) throw new TypeError("Missing fixture")
  const changed = {
    ...input,
    windows: [
      [{ ...first, end: 1, originalFragment: "a" }],
      [{ ...first, start: 1, originalFragment: "😀" }, ...originals.slice(1)],
    ],
  }
  // When the source is planned twice.
  const plan = planFullBookTest(changed)
  // Then the exact immutable graph is reusable and covers both windows.
  expect(validateFullBookTestPlan(changed, plan)).toEqual(plan)
  expect(plan.nodes.filter((node) => node.kind === "map").map((node) => node.window)).toEqual([
    0, 1,
  ])
  expect(Object.isFrozen(plan.nodes)).toBe(true)
})
