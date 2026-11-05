import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { dummyWorkflow } from "./dummy-fixture.ts"
import { digest, seal } from "./integrity.ts"
import { Manifest } from "./workflow-schema.ts"

const directories: string[] = []
export function closeDummyPackets() {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
}
export function dummyPacket() {
  const root = mkdtempSync(join(tmpdir(), "ten29-DUMMY_ONLY-operator-"))
  directories.push(root)
  for (const directory of ["coordinator/events", "coordinator/staged", "human"])
    mkdirSync(join(root, directory), { recursive: true, mode: 0o700 })
  const dummy = dummyWorkflow(),
    documents = dummy.manifest.documents.map((document) => {
      const source = {
        documentCode: document.documentCode,
        parts: [1, 2, 3, 4].map((part) => ({ part, text: "DUMMY_ONLY source" })),
      }
      writeFileSync(join(root, "human", `${document.documentCode}.json`), JSON.stringify(source))
      const candidates = document.candidates.map((candidate) => ({
        documentCode: document.documentCode,
        candidateCode: candidate.candidateCode,
        maps: [],
        synthesis: { text: "DUMMY_ONLY not graded" },
      }))
      writeFileSync(
        join(root, "coordinator/staged", `${document.documentCode}.json`),
        JSON.stringify({ documentCode: document.documentCode, candidates }),
      )
      return {
        ...document,
        sourceDigest: digest(source),
        candidates: document.candidates.map((candidate, index) => ({
          ...candidate,
          contentDigest: digest(candidates[index]),
        })),
      }
    })
  const { packetDigest: _previous, ...body } = dummy.manifest
  const manifest = Manifest.parse({
      ...body,
      documents,
      packetDigest: digest({ ...body, documents }),
    }),
    enrollment = { ...dummy.enrollment, packetDigest: manifest.packetDigest }
  writeFileSync(join(root, "coordinator/operator-key"), dummy.key)
  writeFileSync(join(root, "coordinator/manifest.json"), JSON.stringify(manifest))
  writeFileSync(
    join(root, "coordinator/rubric.json"),
    JSON.stringify({ status: "DUMMY_ONLY anchors" }),
  )
  writeFileSync(
    join(root, "coordinator/provisional-intentions.json"),
    JSON.stringify(
      manifest.documents.flatMap((document) =>
        document.candidates.map((candidate, index) => ({
          candidateCode: candidate.candidateCode,
          intendedLabel: index === 0 ? "faithful" : "negative",
        })),
      ),
    ),
  )
  const assets = [
    "coordinator/manifest.json",
    "coordinator/rubric.json",
    "coordinator/provisional-intentions.json",
    ...documents.flatMap((document) => [
      `human/${document.documentCode}.json`,
      `coordinator/staged/${document.documentCode}.json`,
    ]),
  ].map((path) => ({
    path,
    sha256: createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex"),
  }))
  writeFileSync(
    join(root, "coordinator/prepared-lock.json"),
    JSON.stringify(seal({ kind: "prepared-packet-lock", assets }, dummy.key)),
  )
  const authorization = join(root, "DUMMY_ONLY-authorization.json")
  writeFileSync(
    authorization,
    JSON.stringify({ status: "HUMAN_AUTHORIZED", authorization: enrollment }),
  )
  const execute = (action: string, argument?: string) =>
    spawnSync(
      process.execPath,
      [
        "--experimental-transform-types",
        resolve("tests/acceptance/ten29/assessment-tools-v2/operator.ts"),
        root,
        action,
        ...(argument ? [argument] : []),
      ],
      { encoding: "utf8", timeout: 10000 },
    )
  const response = (name: string, value: unknown) => {
    const path = join(root, name)
    writeFileSync(path, JSON.stringify({ status: "HUMAN_COMPLETED", response: value }))
    return path
  }
  return { root, manifest, authorization, execute, response }
}
