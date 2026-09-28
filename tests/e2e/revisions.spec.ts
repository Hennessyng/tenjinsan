import { expect, test } from "@playwright/test"
import { z } from "zod"
import { briefFixture } from "./brief-fixture.ts"

const Revision = z.object({
  setup: z.object({ id: z.string(), studyId: z.string() }),
  analysis: z.object({ id: z.string() }).nullable(),
  grant: z.unknown().nullable(),
})

test.describe("study revisions", () => {
  let fixture: Awaited<ReturnType<typeof briefFixture>>
  test.beforeEach(async ({ page }) => {
    fixture = await briefFixture()
    await page.goto(`${fixture.origin}/login`)
    await page.getByLabel("Email").fill(fixture.credentials.email)
    await page.getByLabel("Password").fill(fixture.credentials.password)
    await page.getByRole("button", { name: "Log in" }).click()
    await expect(page).toHaveURL(`${fixture.origin}/`)
  })
  test.afterEach(async () => fixture.close())

  test("forks through authenticated HTTP and edits independent answers in the browser", async ({
    page,
  }) => {
    // Given / When
    const result = await page.evaluate(async () => {
      const response = await fetch("/api/revisions/study-fixture/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSetupRevisionId: "setup-brief" }),
      })
      return { status: response.status, body: await response.json() }
    })
    // Then
    expect(result.status).toBe(201)
    const fork = Revision.parse(result.body)
    expect(fork.analysis?.id).toBe("analysis-interview")
    expect(fork.grant).toBeNull()
    await page.goto(`${fixture.origin}/interviews/${fork.setup.studyId}`)
    await page.getByLabel("Your own response").fill("A different reading goal")
    await page.getByRole("button", { name: "Save custom response" }).click()
    await page.reload()
    const definition = fixture.storage.interviews.latest(fork.setup.studyId)
    expect(definition).not.toBeNull()
    expect(fixture.storage.interviews.answers(definition?.id)).toHaveLength(1)
    expect(fixture.storage.interviews.answers("interview-fixture")).toHaveLength(0)
  })

  test("requires a fresh transmission decision and excludes another provider's map", async ({
    page,
  }) => {
    // Given
    const setup = fixture.storage.sources.getLatestSetup("study-fixture")
    if (!setup) throw new TypeError("Missing setup fixture")
    // When
    const result = await page.evaluate(async (setup) => {
      const response = await fetch("/api/revisions/study-fixture/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedSetupRevisionId: setup.id,
          analysis: { ...setup.analysis, provider: "anthropic", model: "claude-fixture" },
          generation: setup.generation,
        }),
      })
      return { status: response.status, body: await response.json() }
    }, setup)
    // Then
    expect(result.status).toBe(201)
    const revision = Revision.parse(result.body)
    expect(revision.analysis).toBeNull()
    expect(revision.grant).toBeNull()
    const grant = await page.evaluate(async (id) => {
      const response = await fetch("/api/revisions/study-fixture/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSetupRevisionId: id, categories: ["book-text"] }),
      })
      return response.status
    }, revision.setup.id)
    expect(grant).toBe(201)
    expect(fixture.storage.sources.getGrant(`grant-${revision.setup.id}`)?.setupRevisionId).toBe(
      revision.setup.id,
    )
  })

  test("rejects stale fork requests without creating studies", async ({ page }) => {
    // Given / When
    const status = await page.evaluate(
      async () =>
        (
          await fetch("/api/revisions/study-fixture/fork", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ expectedSetupRevisionId: "stale-setup" }),
          })
        ).status,
    )
    // Then
    expect(status).toBe(409)
    expect(fixture.storage.counts().studies).toBe(1)
  })
})
