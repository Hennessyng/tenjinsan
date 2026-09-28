import {
  type Bilingual,
  type Practice,
  PublicationRevision,
  practiceTeachingStates,
  requiredTeachingStates,
} from "@reading-studio/contracts"

type PrintNode = {
  readonly textContent: string | null
  querySelectorAll(selector: string): ArrayLike<PrintNode>
  closest(selector: string): PrintNode | null
}
type PrintDocument = Pick<PrintNode, "querySelectorAll">

export function printReadiness(input: unknown, document: PrintDocument) {
  const { projection } = PublicationRevision.parse(input)
  const issues: string[] = []
  const nodes = (selector: string) =>
    Array.from(
      document.querySelectorAll(
        selector.startsWith("main") ? selector : `main[data-print-document] ${selector}`,
      ),
    )
  const requireNode = (selector: string) => {
    const found = nodes(selector)
    if (
      found.length !== 1 ||
      found[0]?.closest(
        '[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]',
      )
    )
      issues.push(selector)
  }
  const text = (selector: string, expected: string) => {
    requireNode(selector)
    if (nodes(selector)[0]?.textContent !== expected) issues.push(`${selector}: content mismatch`)
  }
  const pair = (selector: string, expected: Bilingual) => {
    for (const language of ["en", "ja"] as const)
      text(`${selector} > [lang="${language}"]`, expected[language])
  }
  const state = (value: ReturnType<typeof requiredTeachingStates>[number]) => {
    const selector = `[data-state="${value.id}"]`
    requireNode(selector)
    pair(`${selector} > h4`, value.label)
    pair(`${selector} > .pair`, value.explanation)
  }
  const practice = (exercises: readonly Practice[], prefix: string) => {
    for (const exercise of exercises) {
      const selector = `[data-practice="${prefix}:${exercise.id}"]`
      pair(`${selector} > h3`, exercise.prompt)
      if (exercise.scenario) pair(`${selector} > [data-scenario] > .pair`, exercise.scenario)
      if (exercise.attribution)
        pair(`${selector} > [data-attribution] > .pair`, exercise.attribution)
      if (exercise.kind === "topic") {
        const question = `[data-question="${prefix}:${exercise.id}"]`
        pair(`${question} > h3`, exercise.prompt)
        exercise.options.forEach((option, index) => {
          pair(`${question} > ol > li:nth-child(${index + 1}) > .pair:first-child`, option.label)
          pair(`${question} > ol > li:nth-child(${index + 1}) > .pair:last-child`, option.feedback)
        })
      }
    }
  }
  requireNode("main[data-print-document]")
  const hasTopicQuestions = projection.sections.some(
    (section) =>
      section.practice.some((exercise) => exercise.kind === "topic") ||
      section.scenes.some((scene) => scene.practice.some((exercise) => exercise.kind === "topic")),
  )
  if (hasTopicQuestions) requireNode("#print-questions")
  else if (nodes("#print-questions").length) issues.push("empty question collection")
  requireNode("#print-sources")
  pair("main > h1", projection.title)
  if (nodes("script, canvas, input, textarea, button").length)
    issues.push("interactive content in print DOM")
  let stateCount = 0
  for (const section of projection.sections) {
    pair(`#section-${section.id} > h2`, section.heading)
    pair(`#section-${section.id} > .pair`, section.content)
    for (const scene of section.scenes) {
      pair(`#scene-${scene.id} > h3`, scene.title)
      const states = requiredTeachingStates(scene)
      stateCount += states.length
      states.forEach(state)
      if (scene.kind === "perspective-3d" || scene.kind === "spatial-layers-3d") {
        for (const view of scene.viewpoints) {
          const selector = `[data-static-view="${scene.id}:viewpoint:${view.id}"]`
          requireNode(`${selector} > svg`)
          const objects = scene.kind === "spatial-layers-3d" ? scene.layers.length : 2
          for (let index = 0; index < objects; index++) {
            requireNode(`${selector} > svg [data-static-object="${index}"]`)
            if (!nodes(`${selector} > svg [data-static-object="${index}"] > polygon`).length) {
              issues.push(`${selector}: missing form ${index}`)
            }
          }
          pair(`${selector} > figcaption > h4`, view.label)
          pair(`${selector} > figcaption > .pair`, view.explanation)
        }
      } else {
        requireNode(`#scene-${scene.id} > figure > svg`)
        const marks = nodes(`#scene-${scene.id} > figure > svg [data-scene-mark]`)
        if (marks.length !== requiredTeachingStates({ ...scene, practice: [] }).length) {
          issues.push(`${scene.id}: missing diagram alternative`)
        }
        if (scene.kind === "annotated-process" && scene.loop) {
          requireNode(`#scene-${scene.id} [data-loop-arrow]`)
          requireNode(`#scene-${scene.id} [data-loop-caption]`)
        }
      }
      for (const caption of scene.captions ?? []) {
        pair(`[data-caption="${caption.stateId}"] > .pair`, caption.text)
      }
      practice(scene.practice, scene.id)
    }
    const sectionStates = practiceTeachingStates(section.practice, section.id)
    stateCount += sectionStates.length
    sectionStates.forEach(state)
    practice(section.practice, section.id)
    for (const source of section.sourceNotes) {
      const selector = `[data-source="${section.id}:${source.id}"]`
      pair(`${selector} > h4`, source.title)
      text(`${selector} > .locator`, source.locator)
      pair(`${selector} > .pair`, source.note)
      if (source.quotation) text(`${selector} > blockquote`, source.quotation)
    }
  }
  if (nodes("[data-state]").length !== stateCount) issues.push("state inventory mismatch")
  return Object.freeze({ ready: issues.length === 0, issues: Object.freeze(issues) })
}
