import { chapterFindings, synthesisFindings } from "@reading-studio/contracts"
import { openStorage } from "@reading-studio/storage"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import {
  completeWholeBook,
  WholeBookAdapter,
  wholeBookFixture,
  wholeBookWorker,
} from "./whole-book-fixture.ts"

const fixtures: Awaited<ReturnType<typeof wholeBookFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

it("resumes without replay and verifies findings against neighboring original context", async () => {
  // Given
  const fixture = await wholeBookFixture("The claim. But its exception remains.", 3)
  fixtures.push(fixture)
  const adapter = new WholeBookAdapter()
  const initial = wholeBookWorker(fixture, adapter)
  initial.pipeline.prepare("setup-whole", "grant-whole")
  await initial.worker.runNext()
  fixture.storage.close()
  fixture.storage = openStorage(fixture)
  // When
  const { analysis } = await completeWholeBook(fixture, adapter)
  // Then
  expect(analysis.status).toBe("successful")
  expect(adapter.requests).toHaveLength(4)
  const data = analysis.wholeBook
  if (!data?.synthesis) throw new TypeError("Missing synthetic maps and synthesis")
  const checked = new Set(
    data.verification.flatMap((check) => check.decisions.map((item) => item.id)),
  )
  expect(
    [...data.maps.flatMap(chapterFindings), ...synthesisFindings(data.synthesis)].every((item) =>
      checked.has(item.id),
    ),
  ).toBe(true)
  const request = adapter.requests.at(-1)
  if (!request) throw new TypeError("Missing synthetic verification request")
  const payload = z
    .array(z.unknown())
    .parse(JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n") + 1)))
  const blocks = z.array(z.object({ text: z.string() }).passthrough()).parse(payload.slice(1))
  expect(blocks.some((block) => block.text.includes("But its exception remains."))).toBe(true)
})
