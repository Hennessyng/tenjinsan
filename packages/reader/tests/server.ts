import { createServer } from "node:http"
import { html, raw } from "hono/html"
import {
  languageControls,
  pairedLabel,
  pairedText,
  practiceSection,
  readerDocument,
  readerStyles,
} from "../src/index.ts"
import { lessons } from "./fixtures.ts"
import { practiceLesson } from "./practice-fixture.ts"
import { sceneLesson } from "./scene-fixture.ts"
import { spatialLesson } from "./spatial-fixture.ts"

export { publicationTeachingStateIds } from "@reading-studio/contracts"
export { lessons } from "./fixtures.ts"
export { practiceLesson, replyOptions } from "./practice-fixture.ts"
export { sceneLesson } from "./scene-fixture.ts"
export { layerInventory, perspectiveLegendInventory, spatialInventory } from "./spatial-fixture.ts"

export async function readerFixture() {
  const showcase = html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Reader primitives</title><style>${raw(readerStyles)}</style></head><body><div class="editorial">${languageControls()}<main class="reading-content"><h1 class="pair-label">${pairedLabel(lessons[1].title)}</h1>${lessons[1].sections.map((section) => html`<h2 class="pair-label">${pairedLabel(section.heading)}</h2>${pairedText(section.content)}${practiceSection(section.practice, section.id)}`)}</main></div></body></html>`
  const pages = [
    String(await readerDocument(lessons[0])),
    String(await readerDocument(lessons[1])),
    String(await showcase),
    String(await readerDocument(sceneLesson)),
    String(await readerDocument(spatialLesson)),
    String(await readerDocument(practiceLesson)),
  ]
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8")
    response.end(
      pages[
        request.url === "/practice"
          ? 5
          : request.url === "/spatial"
            ? 4
            : request.url === "/scenes"
              ? 3
              : request.url === "/stress"
                ? 1
                : request.url === "/showcase"
                  ? 2
                  : 0
      ],
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new TypeError("Missing reader test port")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}
