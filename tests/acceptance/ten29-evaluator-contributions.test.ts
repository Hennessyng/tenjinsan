import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chapterFindings } from "@reading-studio/contracts"
import { expect, it } from "vitest"
import { z } from "zod"
import { bookFixtureTurns } from "../../apps/worker/tests/book-map-route-fixture.ts"
import { WholeBookAdapter, wholeBookWorker } from "../../apps/worker/tests/whole-book-fixture.ts"
import { epubEntries, zipFixture } from "../../packages/ingestion/tests/fixtures.ts"
import { corpus, escapeXml, extract } from "./ten29/corpus-support.ts"
import { evaluatorProvenance } from "./ten29/evaluator-controls-v1.ts"
import { auditOriginalAssembly } from "./ten29/evaluator-evidence.ts"
import { evidenceDirectory } from "./ten29/evidence.ts"
import { persistedSource } from "./ten29/persisted-source.ts"
import { WireRange, wirePayload } from "./ten29/processing-evidence.ts"

it("carries every actual heading-map and supplementary original into the real synthesis/check flow", async () => {
  // Given: NEW headed wrapper, not a changed frozen original or hidden independent control.
  const family = corpus.find((item) => item.id === "definitions")
  if (!family) throw new TypeError("Missing frozen definitions source")
  const titles = ["Opening", "Units", "Missingness", "Supplement"]
  const bytes = await zipFixture([
    ...epubEntries.filter(
      (entry) => entry.name === "mimetype" || entry.name === "META-INF/container.xml",
    ),
    {
      name: "book/package.opf",
      text: `<package xmlns="http://www.idpf.org/2007/opf"><manifest>${family.parts.map((_, index) => `<item id="c${index}" href="${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${family.parts.map((_, index) => `<itemref idref="c${index}"${index === 3 ? ' linear="no"' : ""}/>`).join("")}</spine></package>`,
    },
    ...family.parts.map((part, index) => ({
      name: `book/${index + 1}.xhtml`,
      text: `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${titles[index]}</h1><p>${escapeXml(part.text)}</p></body></html>`,
    })),
  ])
  const extracted = await extract(bytes, "epub")
  expect(
    extracted.normalization.resources.flatMap((resource) =>
      resource.status === "included" ? resource.blocks.map((block) => block.text) : [],
    ),
  ).toEqual(family.parts.flatMap((part, index) => [titles[index], part.text]))
  expect(extracted.normalization.resources.at(-1)?.role).toBe("supplementary")
  const fixture = await persistedSource(bytes, extracted)
  try {
    const adapter = new WholeBookAdapter()
    const run = wholeBookWorker(fixture, adapter)
    let analysis = run.pipeline.prepare("setup-whole", "grant-whole")
    // When
    for (let step = 0; step < 20; step++) {
      if ((await run.worker.runNext()).kind === "idle") break
      analysis = run.pipeline.prepare("setup-whole", "grant-whole")
    }
    const data = analysis.wholeBook
    if (!data?.synthesis) throw new TypeError("Missing actual headed synthesis")
    const turns = z
      .array(z.object({ input: z.array(z.object({ text: z.string() })) }))
      .parse(bookFixtureTurns(fixture))
    const payloads = turns.map((turn) => {
      const text = turn.input[0]?.text
      if (!text) throw new TypeError("Missing native body")
      return wirePayload(text)
    })
    const kind = (payload: readonly unknown[]) =>
      z.object({ kind: z.string() }).parse(payload[0]).kind
    const maps = payloads.filter((payload) => kind(payload) === "chapter-map")
    const synthesis = payloads.find((payload) => kind(payload) === "book-synthesis")
    if (!synthesis) throw new TypeError("Missing observed synthesis")
    const envelope = z
      .object({ maps: z.array(z.unknown()), groupIds: z.array(z.string()) })
      .parse(synthesis[0])
    const required = extracted.normalization.resources.flatMap((resource, index) => {
      const block =
        resource.status === "included"
          ? resource.blocks.find((item) => item.text === family.parts[index]?.text)
          : undefined
      if (!block) throw new TypeError("Missing original paragraph")
      return [
        {
          part: family.parts[index]?.id ?? "",
          resourcePath: resource.path,
          blockId: block.id,
          text: block.text,
        },
      ]
    })
    const verification = payloads
      .filter((payload) => kind(payload) === "original-verification")
      .map((payload) =>
        auditOriginalAssembly({ normalization: extracted.normalization, payload, required }),
      )
    const directory = await evidenceDirectory("evaluator-headed-v1")
    await writeFile(
      join(directory, "evidence.json"),
      JSON.stringify(
        {
          provenance: evaluatorProvenance,
          newFixture:
            "headings added only in this separately labeled wrapper; frozen corpus unchanged",
          normalization: extracted.normalization,
          analysis,
          payloads,
          verification,
          mapSourcePaths: data.maps.map((map) => [
            ...new Set(
              chapterFindings(map).flatMap((finding) =>
                finding.sources.map((span) => span.resourcePath),
              ),
            ),
          ]),
          meaning:
            "orchestration/source availability only; fixed fake verdicts are not semantic truth",
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    )
    // Then
    expect(data.groups).toHaveLength(4)
    expect(maps).toHaveLength(4)
    expect(envelope.maps).toEqual(data.maps)
    expect(envelope.groupIds).toEqual(data.groups.map((group) => group.id))
    expect(
      maps
        .flatMap((payload) => z.array(WireRange).parse(payload.slice(1)))
        .filter((range) => range.text === family.parts[3]?.text),
    ).toHaveLength(1)
    expect(data.maps.flatMap(chapterFindings).length).toBeGreaterThan(4)
    expect(verification.at(-1)?.missingParts).toEqual([])
  } finally {
    await fixture.close()
  }
}, 30000)
