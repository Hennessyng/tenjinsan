import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ChapterPartMap, chapterFindings, contentDigest } from "@reading-studio/contracts"
import { proposeNormalBatchedDraft } from "@reading-studio/generation"
import { localRequestBytes, requestFitsCapacity } from "@reading-studio/providers"
import { expect, it } from "vitest"
import {
  bookFixtureCapacity,
  bookFixtureTurns,
} from "../../apps/worker/tests/book-map-route-fixture.ts"
import { batchingFixture } from "../../apps/worker/tests/whole-book-batching-fixture.ts"
import { capacityOutputFrames } from "../../apps/worker/tests/whole-book-capacity-outputs.ts"
import { adaptiveBookPlan } from "../../packages/generation/src/adaptive-book-plan.ts"
import {
  batchTarget,
  batchVerificationRequest,
} from "../../packages/generation/src/batched-verification-request.ts"
import { batchOriginals } from "../../packages/generation/src/batched-verification-source.ts"
import { linkChapter } from "../../packages/generation/src/whole-book-output.ts"
import { evidenceDirectory } from "../acceptance/ten29/evidence.ts"

const books = [
  {
    language: "en",
    text: "The workshop records a general rule: regular practice improves accuracy. A later trial qualifies it: fatigue and unfamiliar tools can reverse the result. The final discussion keeps both the benefit and that limit.\n\n".repeat(
      220,
    ),
  },
  {
    language: "ja",
    text: "工房の記録では、練習を続けると作業が正確になると説明する。後の実験では、疲労や不慣れな道具によって結果が逆転した。結論は、利点とその条件の両方を残している。\n\n".repeat(
      360,
    ),
  },
]
it("measures actual default-planner medium EN/JA verification headroom without authorizing or dispatching work", async () => {
  const directory = await evidenceDirectory("medium-default-headroom"),
    results = []
  for (const book of books) {
    const item = await batchingFixture(book.text)
    try {
      const execution = {
        ...item.execution,
        capacity: bookFixtureCapacity,
        setup: {
          ...item.execution.setup,
          analysis: {
            ...item.execution.setup.analysis,
            processing: {
              ...item.execution.setup.analysis.processing,
              capacityId: bookFixtureCapacity.id,
            },
          },
        },
      }
      const before = item.fixture.storage.counts()
      const plan = await adaptiveBookPlan({ ...execution, cap: 64, used: 0 })
      expect(plan.kind).toBe("ready")
      if (plan.kind !== "ready") throw new TypeError(`Medium default plan refused: ${plan.reason}`)
      expect(plan.windows.length).toBeGreaterThanOrEqual(2)
      expect(plan.windows.length).toBeLessThanOrEqual(8)
      const normal = await proposeNormalBatchedDraft({ ...execution, cap: 64, used: 0 })
      const originals = batchOriginals(execution)
      const measure = (request) => {
        const bytes = localRequestBytes("chatgpt-subscription", request),
          inputTokens = execution.capacity.countInputTokens(request)
        return {
          requestDigest: contentDigest(
            JSON.stringify({
              model: request.model,
              settings: request.settings,
              prompt: request.prompt,
              schema: request.schema,
            }),
          ),
          bytes,
          inputTokens,
          byteLimit: 32000,
          freeBytes: 32000 - bytes,
          contextTokens: execution.capacity.contextTokens,
          reservedOutputTokens: request.settings.maxOutputTokens,
          freeInputTokens:
            execution.capacity.contextTokens - request.settings.maxOutputTokens - inputTokens,
          fits: requestFitsCapacity(request, bytes, execution.capacity),
        }
      }
      const windows = plan.windows.map((window, index) => {
        const spans = (window.ranges ?? [window]).map((range) => {
          const original = originals.find(
            (span) => span.resourcePath === range.resourcePath && span.blockId === range.blockId,
          )
          if (!original) throw new TypeError("Foreign diagnostic window")
          return {
            ...original,
            start: range.start,
            end: range.end,
            originalFragment: original.originalFragment.slice(range.start, range.end),
          }
        })
        const first = spans.find((span) => /\S/u.test(span.originalFragment))
        if (!first) throw new TypeError("Empty diagnostic original")
        const citationStart = first.start + first.originalFragment.search(/\S/u)
        const frames = capacityOutputFrames({
          citation: {
            resourcePath: first.resourcePath,
            blockId: first.blockId,
            start: citationStart,
            end: citationStart + 1,
          },
          groupIds: [window.groupId],
        })
        const map = ChapterPartMap.parse(
          linkChapter({
            output: frames.chapter,
            partId: `headroom-map-${index}`,
            groupId: window.groupId,
            setup: execution.setup,
            ranges: window.ranges ?? [window],
          }),
        )
        const findings = chapterFindings(map)
        const reserve = {
          id:
            normal.kind === "ready"
              ? normal.reserve.id
              : contentDigest("measurement-only identity; no reserve issued"),
        }
        const target = (kind, entries) =>
          batchTarget(
            reserve,
            {
              mapsHash: contentDigest(JSON.stringify(map)),
              synthesisHash: contentDigest("existing rich control"),
            },
            {
              kind,
              originals: spans,
              windowHash: contentDigest(JSON.stringify(spans)),
              batchHash: kind === "window-findings" ? contentDigest(JSON.stringify(entries)) : null,
              findings: entries,
            },
          )
        const emptyMap = measure(
          batchVerificationRequest(execution, { target: target("map-omission", []), findings: [] }),
        )
        const emptyFindings = measure(
          batchVerificationRequest(execution, {
            target: target("window-findings", []),
            findings: [],
          }),
        )
        const richMap = measure(
          batchVerificationRequest(execution, {
            target: target("map-omission", findings),
            findings,
            map,
          }),
        )
        const oneFinding = measure(
          batchVerificationRequest(execution, {
            target: target("window-findings", findings.slice(0, 1)),
            findings: findings.slice(0, 1),
          }),
        )
        const plainFinding = { ...findings[0], text: item.outputs.synthesis.thesis[0].text }
        const plain = measure(
          batchVerificationRequest(execution, {
            target: target("window-findings", [plainFinding]),
            findings: [plainFinding],
          }),
        )
        const minimalMap = ChapterPartMap.parse({
          ...map,
          purpose: null,
          claimStatus: "no-claim",
          claims: [],
          summary: { ...map.summary, text: item.outputs.maps[0].summary.text },
        })
        const minimum = measure(
          batchVerificationRequest(execution, {
            target: target("map-omission", [minimalMap.summary]),
            findings: [minimalMap.summary],
            map: minimalMap,
          }),
        )
        return {
          index,
          originalUtf16: spans.reduce((sum, span) => sum + span.originalFragment.length, 0),
          originalUtf8: spans.reduce(
            (sum, span) => sum + Buffer.byteLength(span.originalFragment),
            0,
          ),
          emptyMap,
          emptyFindings,
          minimalValidNoClaimMap: minimum,
          richMap,
          oneExistingRichFinding: oneFinding,
          existingPlain1600Finding: plain,
          plain1600IncrementBytes: plain.bytes - emptyFindings.bytes,
          richMapIncrementBytes: richMap.bytes - emptyMap.bytes,
          oneRichFindingIncrementBytes: oneFinding.bytes - emptyFindings.bytes,
          richMapFindingCount: findings.length,
          existingFixture:
            "capacityOutputFrames: 10x2000-unit escaped fields; schema/transport admissible, not predicted model output. Plain1600 text from batchingFixture.outputs.synthesis.thesis; minimal summary from its existing map.",
          transport: frames.transport,
        }
      })
      results.push({
        language: book.language,
        sourceUtf16: book.text.length,
        sourceUtf8: Buffer.byteLength(book.text),
        authorizedOriginalUtf16: originals.reduce(
          (sum, span) => sum + span.originalFragment.length,
          0,
        ),
        authorizedOriginalUtf8: originals.reduce(
          (sum, span) => sum + Buffer.byteLength(span.originalFragment),
          0,
        ),
        sourceHash: contentDigest(JSON.stringify(originals)),
        W: plan.windows.length,
        normalProposal:
          normal.kind === "ready"
            ? { kind: normal.kind, B: normal.reserve.maxFindingBatches }
            : normal,
        meter:
          "Existing synthetic UTF8-byte-token grammar; not a production tokenizer or output guarantee",
        emptyMapMeaning:
          "map:null and zero finding bodies: a diagnostic lower-bound envelope, not an executable valid map-omission result. Synthetic diagnostic identity only; no reserve/grant issued.",
        windows,
      })
      expect(item.fixture.storage.counts()).toEqual(before)
      expect(bookFixtureTurns(item.fixture)).toHaveLength(0)
    } finally {
      await item.fixture.close()
    }
  }
  await writeFile(
    join(directory, "measurement.json"),
    JSON.stringify(
      { results, policyChanged: false, providerCalls: 0, newGrantsJobsAttempts: 0 },
      null,
      2,
    ),
    { flag: "wx" },
  )
  console.info(
    JSON.stringify(
      results.map(({ language, W, normalProposal, windows }) => ({
        language,
        W,
        normalProposal,
        windows: windows.map(
          ({
            index,
            emptyMap,
            emptyFindings,
            richMapIncrementBytes,
            oneRichFindingIncrementBytes,
            richMap,
          }) => ({
            index,
            emptyMap,
            emptyFindings,
            richMapIncrementBytes,
            oneRichFindingIncrementBytes,
            richMapFits: richMap.fits,
          }),
        ),
      })),
    ),
  )
}, 60000)
