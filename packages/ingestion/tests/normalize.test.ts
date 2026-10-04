import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { normalizeEpub } from "../src/normalize.ts"
import { encryptionFixture, zipFixture } from "./fixtures.ts"

const xhtml = (body: string) =>
  `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>${body}</body></html>`
const entries = [
  { name: "mimetype", text: "application/epub+zip" },
  {
    name: "META-INF/container.xml",
    text: '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  },
  {
    name: "book/package.opf",
    text: '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="z" href="z.xhtml" media-type="application/xhtml+xml"/><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="pic" href="pic.svg" media-type="image/svg+xml"/></manifest><spine><itemref idref="z"/><itemref idref="a" linear="no"/></spine></package>',
  },
  {
    name: "book/z.xhtml",
    text: xhtml(
      '<h1 id="heading">First</h1><p id="p">Hello <em>world</em>.</p><span epub:type="pagebreak" id="p12" title="12"/><p>After page.</p>',
    ),
  },
  { name: "book/a.xhtml", text: xhtml("<h2>Appendix</h2><p>Extra</p>") },
  {
    name: "book/nav.xhtml",
    text: xhtml(
      '<nav epub:type="toc"><ol><li><a href="z.xhtml#heading">First</a><ol><li><a href="a.xhtml">Extra</a></li></ol></li></ol></nav><nav epub:type="page-list"><a href="z.xhtml#p12">12</a></nav>',
    ),
  },
  { name: "book/pic.svg", text: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
]

async function normalize(fixture = entries) {
  const directory = await mkdtemp(join(tmpdir(), "normalize-"))
  try {
    const path = join(directory, "fixture.epub")
    await writeFile(path, zipFixture(fixture))
    await using file = await open(path, "r")
    return await normalizeEpub(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe("EPUB normalization", () => {
  it.each(["EPUB3", "NCX"])(
    "keeps only safe nested label text in malicious %s navigation",
    async (format) => {
      // Given
      const payload =
        '<script>globalThis.compromised = true</script><style>.hidden { display: none }</style><iframe>blocked frame</iframe><object>blocked object</object><template>blocked template</template><img>blocked image</img><unknown>unknown text</unknown><span xmlns="urn:hostile">foreign text<strong xmlns="http://www.w3.org/1999/xhtml">foreign descendant</strong></span>'
      const safe =
        format === "EPUB3"
          ? `<span>Valid <em>nested <strong>label${payload}</strong></em></span>`
          : `<text>Valid <span xmlns="http://www.daisy.org/z3986/2005/dtbook/">nested <em>label${payload}</em></span></text>`
      const label = safe + payload
      const text =
        format === "EPUB3"
          ? xhtml(
              `<nav epub:type="toc"><ol><li><a href="z.xhtml#heading">${label}</a></li></ol></nav><nav epub:type="page-list"><a href="z.xhtml#p12">${label}</a></nav>`,
            )
          : `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel>${label}</navLabel><content src="z.xhtml#heading"/></navPoint></navMap><pageList><pageTarget><navLabel>${label}</navLabel><content src="z.xhtml#p12"/></pageTarget></pageList></ncx>`
      const fixture = entries.map((entry) => {
        if (entry.name === "book/nav.xhtml") return { ...entry, text }
        if (entry.name === "book/package.opf" && format === "NCX")
          return {
            ...entry,
            text: entry.text
              .replace(
                'media-type="application/xhtml+xml" properties="nav"',
                'media-type="application/x-dtbncx+xml"',
              )
              .replace("<spine>", '<spine toc="nav">'),
          }
        return entry
      })
      // When
      const result = await normalize(fixture)
      // Then
      expect(result.navigation.map((item) => item.label)).toEqual(["Valid nested label"])
      expect(result.pages.map((item) => item.label)).toEqual(["Valid nested label"])
    },
  )

  it("preserves spine order, roles, locators and navigation when filenames differ", async () => {
    // Given / When
    const result = await normalize()
    // Then
    expect(result.chapters.map(({ path, role }) => [path, role])).toEqual([
      ["book/z.xhtml", "main-chapter"],
      ["book/a.xhtml", "supplementary"],
    ])
    expect(result.chapters[0]?.blocks).toEqual([
      { text: "First", heading: 1, fragment: "heading" },
      { text: "Hello world.", fragment: "p" },
      { text: "", fragment: "p12", pageLabel: "12" },
      { text: "After page.", pageLabel: "12" },
    ])
    expect(
      result.navigation.map(({ path, fragment, label, depth }) => [path, fragment, label, depth]),
    ).toEqual([
      ["book/z.xhtml", "heading", "First", 0],
      ["book/a.xhtml", undefined, "Extra", 1],
    ])
    expect(result.pages).toEqual([{ path: "book/z.xhtml", fragment: "p12", label: "12", depth: 0 }])
    expect(result.coverage).toBe("complete")
    expect(result.skipped).toContainEqual({ path: "book/pic.svg", reason: "non-text" })
  })

  it("returns partial coverage when a spine resource is missing", async () => {
    // Given / When
    const result = await normalize(entries.filter((entry) => entry.name !== "book/z.xhtml"))
    // Then
    expect(result.coverage).toBe("partial")
    expect(result.skipped).toContainEqual({
      path: "book/z.xhtml",
      role: "main-chapter",
      reason: "missing-resource",
    })
  })

  it("removes executable and resource-bearing content when XHTML is malicious", async () => {
    // Given: actual script, event handlers, CSS, embedded documents and remote resources.
    const hostile = xhtml(
      '<script>throw new Error("executed")</script><style>@import "http://127.0.0.1:1/css";</style><iframe src="http://127.0.0.1:1/frame">hidden</iframe><object data="file:///etc/passwd">secret</object><svg xmlns="http://www.w3.org/2000/svg"><script>evil()</script></svg><p onclick="evil()" style="background:url(https://example.org/x)">Safe <a href="javascript:evil()">text</a><img src="http://127.0.0.1:1/image" onerror="evil()"/></p>',
    )
    // When
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"))
    const execute = vi.spyOn(globalThis, "eval").mockImplementation(() => {
      throw new Error("execution forbidden")
    })
    const result = await normalize(
      entries.map((entry) => (entry.name === "book/z.xhtml" ? { ...entry, text: hostile } : entry)),
    )
    // Then: only inert text crosses the parser boundary, never markup or attributes.
    expect(result.chapters[0]?.blocks).toEqual([{ text: "Safe text" }])
    expect(network).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it("preserves empty anchors when fragments precede paragraph text", async () => {
    // Given / When
    const result = await normalize(
      entries.map((entry) =>
        entry.name === "book/z.xhtml"
          ? { ...entry, text: xhtml('<div id="section"><a id="anchor"/><p>Passage</p></div>') }
          : entry,
      ),
    )
    // Then
    expect(result.chapters[0]?.blocks).toContainEqual({ text: "", fragment: "anchor" })
    expect(result.chapters[0]?.blocks).toContainEqual({ text: "Passage", fragment: "section" })
  })

  it.each(["https://example.org/chapter", "../../escape", "%2fetc/passwd", "file:///etc/passwd"])(
    "rejects unsafe manifest reference %s",
    async (href) => {
      // Given / When / Then
      await expect(
        normalize(
          entries.map((entry) =>
            entry.name === "book/package.opf"
              ? { ...entry, text: entry.text.replace('href="z.xhtml"', `href="${href}"`) }
              : entry,
          ),
        ),
      ).rejects.toMatchObject({ code: "unsafe-reference" })
    },
  )

  it("rejects malformed XHTML instead of reporting full coverage", async () => {
    // Given / When / Then
    await expect(
      normalize(
        entries.map((entry) =>
          entry.name === "book/z.xhtml" ? { ...entry, text: xhtml("<p>broken") } : entry,
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid-xml" })
  })

  it.each([
    '<!DOCTYPE html SYSTEM "http://127.0.0.1:1/entity">',
    '<!DOCTYPE html [<!ENTITY steal SYSTEM "file:///etc/passwd">]>',
    '<!DOCTYPE html [<!ENTITY a "boom"><!ENTITY b "&a;&a;">]>',
  ])("rejects entity declarations before parsing content: %s", async (declaration) => {
    // Given / When / Then
    await expect(
      normalize(
        entries.map((entry) =>
          entry.name === "book/z.xhtml"
            ? { ...entry, text: declaration + xhtml("<p>&steal;</p>") }
            : entry,
        ),
      ),
    ).rejects.toMatchObject({ code: "unsafe-xml" })
  })

  it("rejects encrypted chapters before reporting coverage", async () => {
    // Given / When / Then
    await expect(
      normalize([
        ...entries,
        { name: "META-INF/encryption.xml", text: encryptionFixture("book/z.xhtml") },
      ]),
    ).rejects.toMatchObject({ code: "encrypted-content" })
  })

  it("uses NCX when EPUB3 navigation is absent", async () => {
    // Given
    const fixture = entries
      .filter((entry) => entry.name !== "book/nav.xhtml")
      .map((entry) =>
        entry.name === "book/package.opf"
          ? {
              ...entry,
              text: entry.text
                .replace(
                  '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
                  '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
                )
                .replace("<spine>", '<spine toc="ncx">'),
            }
          : entry,
      )
    fixture.push({
      name: "book/toc.ncx",
      text: '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>First</text></navLabel><content src="z.xhtml#heading"/><navPoint><navLabel><text>Extra</text></navLabel><content src="a.xhtml"/></navPoint></navPoint></navMap><pageList><pageTarget><navLabel><text>12</text></navLabel><content src="z.xhtml#p12"/></pageTarget></pageList></ncx>',
    })
    // When
    const result = await normalize(fixture)
    // Then
    expect(result.navigation.map((item) => [item.label, item.depth])).toEqual([
      ["First", 0],
      ["Extra", 1],
    ])
    expect(result.pages[0]?.label).toBe("12")
  })
})
