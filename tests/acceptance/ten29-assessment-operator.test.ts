import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { CoverageKind } from "./ten29/assessment-tools-v2/coverage-schema.ts"
import {
  dummyAssessment,
  dummyCoverage,
  dummySource,
  dummyTuning,
} from "./ten29/assessment-tools-v2/dummy-fixture.ts"
import {
  closeDummyPackets,
  dummyPacket,
} from "./ten29/assessment-tools-v2/dummy-operator-fixture.ts"
import { digest } from "./ten29/assessment-tools-v2/integrity.ts"
import { loadWorkflow } from "./ten29/assessment-tools-v2/operator-store.ts"

afterEach(closeDummyPackets)
it("drives the local CLI on DUMMY_ONLY files without premature exposure or overwriting a first pass", () => {
  const packet = dummyPacket()
  expect(packet.execute("release", "first").status).toBe(1)
  expect(packet.execute("enroll", packet.authorization).status).toBe(0)
  expect(packet.execute("release", "first").status).toBe(1)
  for (const [index] of packet.manifest.documents.entries())
    expect(
      packet.execute(
        "lock-source",
        packet.response(`DUMMY-source-${index}.json`, dummySource(packet.manifest, index)),
      ).status,
    ).toBe(0)
  expect(packet.execute("release", "second").status).toBe(1)
  expect(packet.execute("release", "first").status).toBe(0)
  const first = packet.manifest.documents[0],
    second = packet.manifest.documents[1]
  if (!first || !second) throw new TypeError("Missing DUMMY_ONLY documents")
  expect(existsSync(join(packet.root, "human", first.documentCode, "candidates.json"))).toBe(true)
  expect(existsSync(join(packet.root, "human", second.documentCode))).toBe(false)
  expect(
    readFileSync(join(packet.root, "human", first.documentCode, "candidates.json"), "utf8"),
  ).not.toContain("DUMMY-FAMILY")
  const candidate = first.candidates[0]
  if (!candidate) throw new TypeError("Missing DUMMY_ONLY candidate")
  const answer = packet.response(
    "DUMMY-first-pass.json",
    dummyAssessment(loadWorkflow(packet.root), candidate.candidateCode),
  )
  expect(packet.execute("assess", answer).status).toBe(0)
  expect(packet.execute("assess", answer).status).toBe(1)
  expect(readdirSync(join(packet.root, "coordinator/first-passes"))).toHaveLength(1)
  expect(packet.execute("reference-forms").status).toBe(1)
  expect(packet.execute("resume-delivery", "first").status).toBe(0)
  const lastFirst = first.candidates[1]
  if (!lastFirst) throw new TypeError("Missing DUMMY_ONLY candidate")
  expect(
    packet.execute(
      "assess",
      packet.response(
        "DUMMY-first-two.json",
        dummyAssessment(loadWorkflow(packet.root), lastFirst.candidateCode, false),
      ),
    ).status,
  ).toBe(0)
  expect(packet.execute("forms", "finish-tuning").status).toBe(0)
  expect(
    packet.execute(
      "finish-tuning",
      packet.response("DUMMY-round-note.json", dummyTuning(packet.manifest.packetDigest)),
    ).status,
  ).toBe(0)
  expect(packet.execute("release", "second").status).toBe(0)
  for (const [index, next] of second.candidates.entries())
    expect(
      packet.execute(
        "assess",
        packet.response(
          `DUMMY-second-${index}.json`,
          dummyAssessment(loadWorkflow(packet.root), next.candidateCode, index === 0),
        ),
      ).status,
    ).toBe(0)
  expect(packet.execute("forms", "references").status).toBe(1)
  expect(packet.execute("unblind").status).toBe(0)
  expect(packet.execute("forms", "references").status).toBe(0)
  const state = loadWorkflow(packet.root).snapshot()
  for (const document of packet.manifest.documents)
    for (const [index, item] of document.candidates.entries()) {
      const firstPass = state.assessments.find((row) => row.candidateCode === item.candidateCode)
      if (!firstPass) throw new TypeError("Missing DUMMY_ONLY first pass")
      const reference = {
        kind: "label-corroboration",
        mode: "DUMMY_ONLY",
        packetDigest: packet.manifest.packetDigest,
        candidateCode: item.candidateCode,
        humanId: "DUMMY-HUMAN",
        firstPassDigest: digest(firstPass),
        constructedLabelDigest: digest(item.constructed),
        disposition: "agree",
        label: null,
        criticalNegative: null,
        humanConfirmedKinds: index === 0 ? [] : CoverageKind.options,
        originalGroundedReason: "DUMMY_ONLY",
        humanAuthorshipAttestation: true,
        completedAt: "2026-01-01T00:05:00Z",
      }
      expect(
        packet.execute(
          "reference",
          packet.response(`DUMMY-reference-${item.candidateCode}.json`, reference),
        ).status,
      ).toBe(0)
    }
  for (const document of packet.manifest.documents) {
    expect(packet.execute("forms", `coverage:${document.documentCode}`).status).toBe(0)
    expect(
      packet.execute(
        "coverage",
        packet.response(
          `DUMMY-coverage-${document.documentCode}.json`,
          dummyCoverage(loadWorkflow(packet.root), document.documentCode),
        ),
      ).status,
    ).toBe(0)
  }
  const report = packet.execute("report")
  expect(report.status).toBe(0)
  expect(JSON.parse(report.stdout)).toMatchObject({
    mode: "DUMMY_ONLY",
    calibration: { status: "DUMMY CONSTRUCTED-CONTROL ARITHMETIC ONLY" },
    ticketAccepted: false,
  })
  const display = join(
    packet.root,
    "human",
    "corroboration",
    `${candidate.candidateCode}-construction.json`,
  )
  const changed = JSON.parse(readFileSync(display, "utf8"))
  changed.constructed.label = "negative"
  writeFileSync(display, JSON.stringify(changed))
  expect(packet.execute("report").status).toBe(1)
})
it("rejects changed prepared originals instead of trusting a form's old source digest", () => {
  const packet = dummyPacket(),
    first = packet.manifest.documents[0]
  if (!first) throw new TypeError("Missing DUMMY_ONLY document")
  expect(packet.execute("enroll", packet.authorization).status).toBe(0)
  writeFileSync(
    join(packet.root, "human", `${first.documentCode}.json`),
    JSON.stringify({ documentCode: first.documentCode, parts: [] }),
  )
  expect(
    packet.execute(
      "lock-source",
      packet.response("DUMMY-source.json", dummySource(packet.manifest)),
    ).status,
  ).toBe(1)
  expect(readdirSync(join(packet.root, "coordinator/events"))).toEqual([])
})
it("refuses intake after a delivered candidate was changed without changing its prefilled digest", () => {
  const packet = dummyPacket(),
    first = packet.manifest.documents[0]
  if (!first?.candidates[0]) throw new TypeError("Missing DUMMY_ONLY candidate")
  expect(packet.execute("enroll", packet.authorization).status).toBe(0)
  for (const [index] of packet.manifest.documents.entries())
    expect(
      packet.execute(
        "lock-source",
        packet.response(`DUMMY-source-${index}.json`, dummySource(packet.manifest, index)),
      ).status,
    ).toBe(0)
  expect(packet.execute("release", "first").status).toBe(0)
  const response = packet.response(
    "DUMMY-after-tamper.json",
    dummyAssessment(loadWorkflow(packet.root), first.candidates[0].candidateCode),
  )
  const candidatePath = join(packet.root, "human", first.documentCode, "candidates.json"),
    changed = JSON.parse(readFileSync(candidatePath, "utf8"))
  changed.candidates[0].synthesis.text = "DUMMY_ONLY substituted display"
  writeFileSync(candidatePath, JSON.stringify(changed))
  expect(packet.execute("assess", response).status).toBe(1)
  expect(readdirSync(join(packet.root, "coordinator/events"))).toHaveLength(3)
})
