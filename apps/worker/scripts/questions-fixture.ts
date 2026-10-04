import { generateQuestions } from "@reading-studio/generation/questions"
import { questionsFixture } from "../tests/questions-fixture.ts"

const { input, draft } = questionsFixture()
const result = generateQuestions(input, draft)
let staleRejected = false
try {
  generateQuestions(input, { ...draft, analysisRevisionId: "stale-analysis" })
} catch (error) {
  if (!(error instanceof Error) || error.message !== "revision-mismatch") throw error
  staleRejected = true
}
if (!staleRejected) throw new TypeError("Stale fixture output was accepted")
process.stdout.write(`${JSON.stringify({ result, staleRejected }, null, 2)}\n`)
