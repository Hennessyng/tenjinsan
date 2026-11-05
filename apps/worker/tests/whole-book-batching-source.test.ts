import { BookSynthesis, StudySetupRevision } from "@reading-studio/contracts"
import { approveBatchedVerification, planBatchedVerification } from "@reading-studio/generation"
import { afterEach, expect, it } from "vitest"
import { batchingFixture } from "./whole-book-batching-fixture.ts"

const fixtures: Awaited<ReturnType<typeof batchingFixture>>[] = []
afterEach(async () => {
  for (const item of fixtures.splice(0)) await item.fixture.close()
})

it("binds every target to the full candidate root and refuses a changed source/settings plan", async () => {
  const item = await batchingFixture()
  fixtures.push(item)
  const approved = approveBatchedVerification(item.execution, item.windows, {
    maxFindingBatches: 4,
    cap: 64,
    used: 0,
  })
  if (approved.kind !== "ready") throw new TypeError("Missing admission")
  const plan = { reserve: approved.reserve, windows: item.windows }
  const first = planBatchedVerification(item.execution, plan, item.outputs)
  const changed = BookSynthesis.parse({
    ...item.outputs.synthesis,
    thesis: item.outputs.synthesis.thesis.map((finding) => ({
      ...finding,
      text: `Z${finding.text.slice(1)}`,
    })),
  })
  const second = planBatchedVerification(item.execution, plan, {
    ...item.outputs,
    synthesis: changed,
  })
  expect(first.kind).toBe("ready")
  expect(second.kind).toBe("ready")
  if (first.kind !== "ready" || second.kind !== "ready")
    throw new TypeError("Missing complete plans")
  expect(
    second.manifest.targets.some((target) =>
      first.manifest.targets.some((old) => old.id === target.id),
    ),
  ).toBe(false)
  const setup = StudySetupRevision.parse({
    ...item.execution.setup,
    analysis: {
      ...item.execution.setup.analysis,
      settings: { ...item.execution.setup.analysis.settings, maxOutputTokens: 999 },
    },
  })
  expect(planBatchedVerification({ ...item.execution, setup }, plan, item.outputs)).toMatchObject({
    kind: "limited",
    reason: "foreign-approved-plan",
  })
})

it("only accepts a complete Unicode-safe source partition proposed before approval", async () => {
  const item = await batchingFixture("A🧭e\u0301日本語tail")
  fixtures.push(item)
  const first = item.windows[0]?.[0]
  if (!first) throw new TypeError("Missing source")
  const split = (end: number) => [
    [{ ...first, end, originalFragment: first.originalFragment.slice(0, end) }],
    [{ ...first, start: end, originalFragment: first.originalFragment.slice(end) }],
    ...item.windows.slice(1),
  ]
  const approve = (windows: ReturnType<typeof split>) => {
    const setup = StudySetupRevision.parse({
      ...item.execution.setup,
      analysis: {
        ...item.execution.setup.analysis,
        processing: {
          ...item.execution.setup.analysis.processing,
          plan: windows.map((window) => ({
            groupId: item.outputs.maps[0]?.groupId,
            ranges: window.map(({ resourcePath, blockId, start, end }) => ({
              resourcePath,
              blockId,
              start,
              end,
            })),
          })),
        },
      },
    })
    return approveBatchedVerification({ ...item.execution, setup }, windows, {
      maxFindingBatches: 1,
      cap: 64,
      used: 0,
    })
  }
  expect(approve(split(2))).toMatchObject({ kind: "limited", reason: "invalid-source-partition" })
  expect(approve(split(3)).kind).toBe("ready")
})
