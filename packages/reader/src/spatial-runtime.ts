import { createSpatialRenderer } from "./spatial-renderer.ts"

function mountSpatial(figure: HTMLElement) {
  if (figure.dataset["renderer"] === "disposed") {
    const previous = figure.querySelector("canvas")
    if (previous) previous.replaceWith(previous.cloneNode())
  }
  const controls = figure.querySelector<HTMLFieldSetElement>("[data-spatial-controls]")
  const live = figure.querySelector<HTMLElement>(".spatial-live")
  const status = figure.querySelector<HTMLElement>("[data-spatial-status]")
  const views = [...figure.querySelectorAll<HTMLButtonElement>("[data-view]")]
  const layers = [...figure.querySelectorAll<HTMLButtonElement>("[data-layer]")]
  if (!controls || !live || !status || views.length === 0 || views.length > 12) return () => {}
  const lifetime = new AbortController()
  const options = { signal: lifetime.signal }
  const printing = matchMedia("print")
  let renderer: ReturnType<typeof createSpatialRenderer> = null
  let view = 0
  let selected = -1
  let visible = false
  let disposed = false
  let printingEvent = false
  let failed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    lifetime.abort()
    intersection.disconnect()
    resize.disconnect()
    renderer?.dispose()
    renderer = null
    controls.hidden = true
    live.hidden = true
    figure.dataset["renderer"] = "disposed"
  }
  const draw = () => {
    if (disposed || failed) return
    if (!visible || document.hidden || printing.matches || printingEvent) {
      figure.dataset["renderer"] = "suspended"
      return
    }
    if (!renderer) renderer = createSpatialRenderer(figure)
    if (!renderer) {
      failed = true
      figure.dataset["renderer"] = "fallback"
      return
    }
    live.hidden = false
    renderer.render(view, selected)
    figure.dataset["renderer"] = "ready"
  }
  const update = () => {
    views.forEach((button, index) => {
      button.setAttribute("aria-pressed", String(index === view))
    })
    layers.forEach((button, index) => {
      button.setAttribute("aria-pressed", String(index === selected))
    })
    figure.dataset["currentView"] = views[view]?.dataset["view"] ?? ""
    figure.dataset["currentLayer"] = layers[selected]?.dataset["layer"] ?? ""
    for (const language of ["en", "ja"]) {
      const text = status.querySelector(`[lang="${language}"]`)
      if (text)
        text.textContent = `${views[view]?.querySelector(`[lang="${language}"]`)?.textContent ?? ""}${selected >= 0 ? ` · ${layers[selected]?.querySelector(`[lang="${language}"]`)?.textContent ?? ""}` : ""}`
    }
    draw()
  }
  views.forEach((button, index) => {
    button.addEventListener(
      "click",
      () => {
        view = index
        update()
      },
      options,
    )
  })
  layers.forEach((button, index) => {
    button.addEventListener(
      "click",
      () => {
        selected = index
        update()
      },
      options,
    )
  })
  document.addEventListener("visibilitychange", draw, options)
  printing.addEventListener("change", draw, options)
  window.addEventListener(
    "beforeprint",
    () => {
      printingEvent = true
      draw()
    },
    options,
  )
  window.addEventListener(
    "afterprint",
    () => {
      printingEvent = false
      draw()
    },
    options,
  )
  figure.querySelector("canvas")?.addEventListener("webglcontextlost", dispose, options)
  const intersection = new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting)
    draw()
  })
  const resize = new ResizeObserver(draw)
  resize.observe(figure)
  controls.hidden = false
  intersection.observe(figure)
  update()
  return dispose
}

const spatialDisposers = new Map<HTMLElement, () => void>()
const removals = new MutationObserver(() => {
  for (const [figure, dispose] of spatialDisposers)
    if (!figure.isConnected) {
      dispose()
      spatialDisposers.delete(figure)
    }
})
function mountSpatialScenes() {
  for (const figure of document.querySelectorAll<HTMLElement>("[data-three-scene]")) {
    if (!spatialDisposers.has(figure)) spatialDisposers.set(figure, mountSpatial(figure))
  }
  removals.observe(document.body, { childList: true, subtree: true })
}
window.addEventListener("pagehide", () => {
  removals.disconnect()
  for (const dispose of spatialDisposers.values()) dispose()
  spatialDisposers.clear()
})
window.addEventListener("pageshow", mountSpatialScenes)
mountSpatialScenes()
