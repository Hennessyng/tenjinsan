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
              const lineage = /Exact analysisRevisionId=([^,]+), contextRevisionId=([^.]+)\./u.exec(
                prompt,
              )
              const excludedSentinelPresent = prompt.includes("WITHHELD_FIXTURE_PASSAGE")
              appendFileSync(
                join(control, "prompt-inspections.jsonl"),
                `${JSON.stringify({
                  stage: lineage ? "questions" : "analysis",
                  excludedSentinelPresent,
                })}\n`,
              )
              if (excludedSentinelPresent)
                throw new TypeError("Excluded synthetic content reached the tool")
              if (lineage) {
                const table = /Citations: (.*?) Passages:/u.exec(prompt)
                if (!table) throw new TypeError("Synthetic citation table missing")
                const source = JSON.parse(table[1])[0].span
                const paired = (en) => ({ en, ja: `日本語 ${en}` })
                writeFileSync(
                  join(control, "questions-output.json"),
                  JSON.stringify({
                    analysisRevisionId: lineage[1],
                    contextRevisionId: lineage[2],
                    groups: [{ id: "focus", label: paired("Focus") }],
                    lenses: [
                      {
                        id: "attention",
                        revisionId: `question-${lineage[2]}`,
                        groupId: "focus",
                        learningGoalKey: "attention",
                        label: paired("Attention"),
                        rationale: paired("Explore attention"),
                        sources: [source],
                        complications: [{ label: paired("Consider limits"), sources: [source] }],
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
