import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { contentDigest } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import {
  fullBookConsentInput as consentInput,
  fullBookServerFixture as given,
} from "./testing/full-book-run-fixture.ts"

it("atomically saves exact managed consent as paused, without issuing any attempts", async () => {
  // Given a bound synthetic binary and explicit acknowledgements of the exact review.
  const f = given()
  try {
    const input = await consentInput(f)
    // When consent is recorded, then the immutable pair holds the plan but never launches work.
    const response = await f.post("consent", input)
    expect(response.status, await response.clone().text()).toBe(201)
    expect(await response.json()).toMatchObject({
      state: "paused",
      native: { enabled: false },
      usedAttempts: 0,
      plannedMaxAttempts: input.acknowledgements.maxAttempts,
    })
    expect(
      f.storage.fullBookConsent.preview(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toMatchObject({ spent: 0, held: input.acknowledgements.maxAttempts })
    expect(f.storage.counts().attempts).toBe(0)
    expect((await f.post("consent", input)).status).toBe(409)
  } finally {
    f.cleanup()
  }
})
it.each([
  "appBoundedNotProviderLimits",
  "coverageAndOmissions",
  "budgetAndUnknown",
  "readableAndDerived",
])("requires a distinct explicit %s acknowledgement", async (key) => {
  // Given a current exact review but one unchecked acknowledgement.
  const f = given()
  try {
    const input = await consentInput(f)
    const response = await f.post("consent", {
      ...input,
      acknowledgements: { ...input.acknowledgements, [key]: false },
    })
    // When/Then no consent or hold is created from an unchecked control.
    expect(response.status).toBe(400)
    expect(
      f.storage.fullBookConsent.preview(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ).held,
    ).toBe(0)
  } finally {
    f.cleanup()
  }
})
it.each([
  "source",
  "setup",
  "account",
  "budget",
  "binary",
  "plan",
  "omissions",
  "unknown",
  "enable",
])("refuses stale or injected %s proof without new charges", async (change) => {
  // Given an owner review that becomes stale or is altered before consent.
  const f = given()
  try {
    const input = await consentInput(f)
    let body: unknown = input
    switch (change) {
      case "source":
        f.storage.sources.appendNormalization({
          record: { ...f.budget.session.input.normalization, id: "new-source-revision" },
          parentRevisionId: f.budget.session.input.normalization.id,
        })
        break
      case "setup":
        f.storage.sources.appendSetup({
          record: { ...f.setup, id: "new-setup" },
          parentRevisionId: f.setup.id,
        })
        break
      case "account":
        f.storage.subscriptionConnections.disconnect(
          f.budget.session.destination.installationId,
          "chatgpt-subscription",
        )
        break
      case "budget":
        f.storage.fullBookConsent.approve({ ...f.budget, id: randomUUID() })
        break
      case "binary":
        writeFileSync(f.binaryPath, "changed binary bytes")
        break
      case "plan":
        body = { ...input, acknowledgements: { ...input.acknowledgements, maxAttempts: 1 } }
        break
      case "omissions":
        body = {
          ...input,
          acknowledgements: {
            ...input.acknowledgements,
            omissionsHash: contentDigest("wrong omissions"),
          },
        }
        break
      case "unknown":
        body = { ...input, acknowledgements: { ...input.acknowledgements, priorUnknown: 9 } }
        break
      case "enable":
        body = { ...input, nativeEnabled: true }
        break
      default:
        throw new TypeError("Unknown consent test mutation")
    }
    // When/Then fresh in-transaction validation refuses the stale approval or browser bypass.
    expect((await f.post("consent", body)).status).toBe(change === "enable" ? 400 : 409)
    expect(f.storage.counts().attempts).toBe(0)
  } finally {
    f.cleanup()
  }
})
it("serializes competing approvals against the same current source budget", async () => {
  // Given two clients holding the exact same old budget review.
  const f = given()
  try {
    const input = await consentInput(f)
    // When both approve, then only the transaction with the fresh proof can reserve the envelope.
    const replies = await Promise.all([
      f.post("consent", input),
      f.post("consent", { ...input, submissionId: randomUUID() }),
    ])
    expect(replies.map((reply) => reply.status).sort()).toEqual([201, 409])
    expect(
      f.storage.fullBookConsent.preview(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ).held,
    ).toBe(input.acknowledgements.maxAttempts)
  } finally {
    f.cleanup()
  }
})
it("rolls back budget and consent together when the bound binary changes during approval", async () => {
  // Given a runtime identity that changes after the native consent write but before commit.
  const f = given()
  try {
    const input = await consentInput(f),
      before = f.storage.fullBookConsent.preview(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
      resolve = f.runtime.resolve
    let calls = 0
    f.runtime.resolve = (options) => {
      if (++calls === 2) writeFileSync(f.binaryPath, "raced binary")
      return resolve(options)
    }
    // When/Then the final identity check rolls back both records and all proposed holds.
    expect((await f.post("consent", input)).status).toBe(409)
    expect(
      f.storage.fullBookConsent.preview(
        f.budget.ownerId,
        f.budget.session.input.normalization.editionHash,
      ),
    ).toEqual(before)
    expect(f.storage.fullBookManagedConsents.history(f.budget.ownerId, f.setup.id)).toHaveLength(0)
  } finally {
    f.cleanup()
  }
})
