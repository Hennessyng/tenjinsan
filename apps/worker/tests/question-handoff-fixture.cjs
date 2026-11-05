const readline = require("node:readline")
const { appendFileSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")
const createInterface = readline.createInterface
const control = process.argv.find((arg) => arg.startsWith("control:"))?.slice(8)
readline.createInterface = (...args) => {
  const stream = createInterface(...args)
  const on = stream.on.bind(stream)
  stream.on = (event, listener) =>
    on(
      event,
      event !== "line"
        ? listener
        : (line) => {
            const request = JSON.parse(line)
            if (request.method === "turn/start") {
              const prompt = request.params.input[0].text
              const packet = prompt
                .split("\n")
                .map((line) => {
                  try {
                    return JSON.parse(line)
                  } catch {
                    return null
                  }
                })
                .find((item) => item?.task === "question-evidence-refs-v1")
              const excludedSentinelPresent = prompt.includes("WITHHELD_FIXTURE_PASSAGE")
              appendFileSync(
                join(control, "prompt-inspections.jsonl"),
                `${JSON.stringify({
                  stage: packet ? "questions" : "analysis",
                  excludedSentinelPresent,
                })}\n`,
              )
              if (excludedSentinelPresent)
                throw new TypeError("Excluded synthetic content reached the tool")
              if (packet) {
                const reference = packet.citations[0]?.id
                if (!reference) throw new TypeError("Synthetic citation reference missing")
                const paired = (en) => ({ en, ja: `日本語 ${en}` })
                writeFileSync(
                  join(control, "questions-output.json"),
                  JSON.stringify({
                    version: "question-evidence-refs-v1",
                    binding: packet.binding,
                    groups: [{ id: "focus", label: paired("Focus") }],
                    lenses: [
                      {
                        id: "attention",
                        groupId: "focus",
                        learningGoalKey: "attention",
                        label: paired("Attention"),
                        rationale: paired("Explore attention"),
                        evidenceRefs: [reference],
                        complications: [
                          { label: paired("Consider limits"), evidenceRefs: [reference] },
                        ],
                        prompt: paired("Which practice?"),
                        mode: "single",
                        minSelections: 1,
                        maxSelections: 1,
                        options: ["listen", "ask"].map((id) => ({
                          id,
                          goalKey: id,
                          label: paired(id),
                          rationale: paired(`Practice ${id}`),
                        })),
                      },
                    ],
                  }),
                )
              }
            }
            listener(line)
          },
    )
  return stream
}
require("../../../packages/storage/tests/subscription-execution-fixture.cjs")
