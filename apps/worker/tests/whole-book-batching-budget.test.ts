import { wholeBookAllowance } from "@reading-studio/generation"
import { expect, it } from "vitest"

it("reserves every proposed v4 omission, window×batch and citation job before consent", () => {
  // Given / When
  const allowance = wholeBookAllowance({
    windows: 2,
    cap: 64,
    used: 0,
    verification: { version: "batched-original-check-4", maxFindingBatches: 3 },
  })
  // Then
  expect(allowance.plannedAttempts).toBe(40)
  expect(allowance.reservedLaterAttempts).toBe(12)
  expect(allowance.cap).toBe(64)
})

it("keeps the hard64 cap and charges used/uncertain attempts rather than inventing allowance", () => {
  const allowance = wholeBookAllowance({
    windows: 3,
    cap: 100,
    used: 7,
    verification: { version: "batched-original-check-4", maxFindingBatches: 4 },
  })
  expect(allowance.cap).toBe(64)
  expect(allowance.remaining).toBe(57)
  expect(allowance.plannedAttempts).toBe(58)
  expect(allowance.plannedAttempts).toBeGreaterThan(allowance.remaining)
})

it("leaves v2/v3 arithmetic unchanged and rejects a zero or fractional proposed batch reserve", () => {
  expect(wholeBookAllowance({ windows: 3, cap: 64, used: 0 }).plannedAttempts).toBe(28)
  for (const maxFindingBatches of [0, 1.5])
    expect(() =>
      wholeBookAllowance({
        windows: 1,
        cap: 64,
        used: 0,
        verification: { version: "batched-original-check-4", maxFindingBatches },
      }),
    ).toThrow()
})

it.each([
  { windows: 8, B: 1, cap: 64, used: 0, fits: true },
  { windows: 9, B: 1, cap: 64, used: 0, fits: false },
  { windows: 8, B: 2, cap: 64, used: 0, fits: false },
  { windows: 8, B: 1, cap: 64, used: 1, fits: false },
  { windows: 8, B: 1, cap: 63, used: 0, fits: false },
])(
  "enforces the disclosed v4 window-budget boundary: $windows windows/$B batches, cap$cap used$used",
  ({ windows, B, cap, used, fits }) => {
    const value = wholeBookAllowance({
      windows,
      cap,
      used,
      verification: { version: "batched-original-check-4", maxFindingBatches: B },
    })
    expect(value.plannedAttempts <= value.remaining).toBe(fits)
    expect(value.reservedLaterAttempts).toBe(12)
  },
)
it("retains the earlier v2 twelve-window budget boundary without treating it as v4 capacity", () => {
  expect(wholeBookAllowance({ windows: 12, cap: 64, used: 0 }).plannedAttempts).toBe(64)
  expect(wholeBookAllowance({ windows: 13, cap: 64, used: 0 }).plannedAttempts).toBeGreaterThan(64)
})
