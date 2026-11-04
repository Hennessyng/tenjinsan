import { type BrowserContext, expect, type Page } from "@playwright/test"
import type { Storage } from "@reading-studio/storage"

type Fixture = { readonly origin: string; close: () => Promise<void> }
const devOrigin = "http://127.0.0.1:4173"
const origins = new Set<string>()
const registered = new WeakSet<Fixture>()
const contexts = new WeakSet<BrowserContext>()
const denied: string[] = []
let nativeFetch = globalThis.fetch

export function fenceLocalFixture<F extends Fixture>(fixture: F): F {
  if (registered.has(fixture)) return fixture
  registered.add(fixture)
  if (origins.size === 0) {
    nativeFetch = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url)
      if (!origins.has(url.origin) && url.origin !== devOrigin) {
        denied.push(url.origin)
        throw new TypeError("External fixture request forbidden")
      }
      return nativeFetch(input, init)
    }
  }
  origins.add(fixture.origin)
  const before = denied.length
  const close = fixture.close
  fixture.close = async () => {
    try {
      await close()
    } finally {
      origins.delete(fixture.origin)
      if (origins.size === 0) globalThis.fetch = nativeFetch
      expect(denied.slice(before), "No external/account/provider request is allowed").toEqual([])
    }
  }
  return fixture
}

export async function anonymousLocal(page: Page, fixture: Fixture, path = "/") {
  fenceLocalFixture(fixture)
  const context = page.context()
  if (!contexts.has(context)) {
    contexts.add(context)
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url())
      if (origins.has(url.origin) || url.origin === devOrigin) return route.continue()
      denied.push(url.origin)
      await route.abort("blockedbyclient")
    })
  }
  const response = await page.goto(new URL(path, fixture.origin).href)
  expect(response?.status()).toBe(200)
  expect(
    (await context.cookies(fixture.origin)).filter((cookie) => /auth|session/i.test(cookie.name)),
  ).toEqual([])
}

export async function proxyAnonymousApi(page: Page, fixture: Fixture) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== devOrigin && url.origin !== fixture.origin)
      throw new TypeError("Unexpected feature API origin")
    await route.fulfill({
      response: await route.fetch({
        url: `${fixture.origin}${url.pathname}${url.search}`,
        headers: { ...route.request().headers(), origin: fixture.origin },
      }),
    })
  })
}

export async function selectAnonymousStudy(page: Page, study = "study-fixture") {
  await page.goto(`${devOrigin}/sources`)
  await page.getByLabel("Selected study", { exact: true }).selectOption(study)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/library-selection" &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Select study", exact: true }).click(),
  ])
  await expect(page.getByLabel("Selected study", { exact: true })).toHaveValue(study)
}

export function foreignFeatureStudy(fixture: { readonly storage: Storage }) {
  const id = "feature-foreign-study"
  expect(fixture.storage.sources.getNormalization("foreign-revision")).not.toBeNull()
  expect(fixture.storage.sources.listStudiesByEdition("foreign-edition")).toEqual([])
  return id
}
