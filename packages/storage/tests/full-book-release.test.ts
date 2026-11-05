import { FullBookManagedPolicy, PINNED_CODEX_BUILD } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { fullBookNativeCompatible, fullBookNativeReleased } from "../src/full-book-release.ts"

it("distinguishes compatible native build from dispatch authorization", () => {
  // Given the build explicitly authorized for the reviewed M6 operation.
  const build = FullBookManagedPolicy.unwrap().shape.build.parse({
    kind: "pinned-codex",
    binaryPath: "/reviewed/native/codex",
    ...PINNED_CODEX_BUILD,
  })
  // When/Then a compatible build alone grants no source or HTTP authority.
  expect(fullBookNativeCompatible(build)).toBe(true)
  expect(fullBookNativeReleased(build)).toBe(false)
})
it("does not promote fixtures or substitute a different native identity", () => {
  // Given fixture evidence or an altered native SHA/version.
  const schema = FullBookManagedPolicy.unwrap().shape.build
  const fixture = schema.parse({
    kind: "fixture-not-live-evidence",
    binaryPath: "/fixture/tool",
    sha256: PINNED_CODEX_BUILD.sha256,
  })
  // When/Then fixture evidence remains non-live and native substitutions fail their boundary schema.
  expect(fullBookNativeReleased(fixture)).toBe(false)
  expect(
    schema.safeParse({
      kind: "pinned-codex",
      binaryPath: "/reviewed/native/codex",
      ...PINNED_CODEX_BUILD,
      sha256: "f".repeat(64),
    }).success,
  ).toBe(false)
  expect(
    schema.safeParse({
      kind: "pinned-codex",
      binaryPath: "/reviewed/native/codex",
      ...PINNED_CODEX_BUILD,
      version: "other",
    }).success,
  ).toBe(false)
})
