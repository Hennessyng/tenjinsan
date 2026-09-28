/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import type { PublicationRevision } from "@reading-studio/contracts"
import type { Page } from "playwright"
import { printReadiness } from "../print/readiness.ts"
import { PdfExportError, pdfLimits } from "./policy.ts"

export async function waitForPrintReady(page: Page, revision: PublicationRevision) {
  const selectors = new Set<string>()
  printReadiness(revision, {
    querySelectorAll(selector) {
      selectors.add(selector)
      return []
    },
  })
  const snapshot = await page.evaluate(
    async ({ selectors, nodeLimit }) => {
      if (document.querySelectorAll("*").length > nodeLimit) return { reason: "limit" } as const
      const fonts = [...document.fonts]
      if (!fonts.length) return { reason: "font" } as const
      try {
        await Promise.all(fonts.map((font) => font.load()))
        await document.fonts.ready
      } catch (error) {
        if (error instanceof DOMException) return { reason: "font" } as const
        throw error
      }
      await Promise.all([...document.images].map((image) => image.decode()))
      const nodes = selectors.map((selector) => ({
        selector,
        nodes: [...document.querySelectorAll(selector)].map((node) => ({
          textContent: node.textContent,
          hidden:
            !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
            Boolean(node.closest('[hidden], [aria-hidden="true"]')),
        })),
      }))
      const leaves = [
        ...document.querySelectorAll("main *:not(title):not(desc):not(style)"),
      ].filter((node) =>
        [...node.childNodes].some(
          (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
        ),
      )
      let overflow = false
      leaves.forEach((node, index) => {
        node.setAttribute("data-pdf-text", String(index))
        const rect = node.getBoundingClientRect()
        if (rect.left < 0 || rect.right > innerWidth + 1 || rect.width === 0 || rect.height === 0)
          overflow = true
      })
      return { reason: "checked", nodes, overflow } as const
    },
    { selectors: [...selectors], nodeLimit: pdfLimits.nodes },
  )
  if (snapshot.reason !== "checked") throw new PdfExportError(snapshot.reason)
  const actual = new Map(snapshot.nodes.map((entry) => [entry.selector, entry.nodes]))
  const readiness = printReadiness(revision, {
    querySelectorAll(selector) {
      return (actual.get(selector) ?? []).map((node) => ({
        textContent: node.textContent,
        querySelectorAll: () => [],
        closest: () =>
          node.hidden
            ? { textContent: null, querySelectorAll: () => [], closest: () => null }
            : null,
      }))
    },
  })
  if (!readiness.ready || snapshot.overflow) throw new PdfExportError("readiness")

  const session = await page.context().newCDPSession(page)
  try {
    await session.send("DOM.enable")
    await session.send("CSS.enable")
    const { root } = await session.send("DOM.getDocument")
    const { nodeIds } = await session.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "[data-pdf-text]",
    })
    for (const nodeId of nodeIds) {
      const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId })
      if (fonts.some((font) => font.glyphCount > 0 && !font.isCustomFont))
        throw new PdfExportError("font")
    }
  } finally {
    await session.detach()
  }
}
