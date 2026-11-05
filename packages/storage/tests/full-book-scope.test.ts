import { FullBookManagedPolicy } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { fullBookNativeReleased } from "../src/full-book-release.ts"
import { approvedBuild, approvedScope } from "./full-book-scope-fixture.ts"

it("does not authorize dispatch with a compatible build alone", () => {
  // Given the approved build but no trusted stored target tuple.
  // When/Then compatibility alone cannot release a source-bearing run.
  expect(fullBookNativeReleased(approvedBuild)).toBe(false)
})
it("does not let a complete caller tuple or fixture install published native authority", () => {
  // Given a wholly synthetic tuple and a matching declared build pin.
  // When/Then neither caller data nor fixture evidence enables the empty trusted composition.
  expect(fullBookNativeReleased(approvedBuild, approvedScope)).toBe(false)
  expect(
    fullBookNativeReleased(
      FullBookManagedPolicy.unwrap().shape.build.parse({
        kind: "fixture-not-live-evidence",
        binaryPath: approvedBuild.binaryPath,
        sha256: approvedBuild.sha256,
      }),
      approvedScope,
    ),
  ).toBe(false)
})
it.each(Object.entries(approvedScope))(
  "refuses changed %s even when all other options match",
  (key, value) => {
    // Given one altered study/setup/source/recipient/model/settings/fence/plan/budget/ack/runtime binding.
    const changed = {
      ...approvedScope,
      [key]: typeof value === "number" ? value + 1 : `${value}-other`,
    }
    // When/Then an exported caller tuple is comparison data, never a way to install a release.
    expect(fullBookNativeReleased(approvedBuild, changed)).toBe(false)
    expect(fullBookNativeReleased(approvedBuild, { ...approvedScope, [key]: undefined })).toBe(
      false,
    )
  },
)
