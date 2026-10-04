/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// Loaded only as trusted browser code; keeping DOM types out of the server avoids global type pollution.
function mountSceneRuntime() {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)")
  const printing = matchMedia("print")
  const disposers = new Map<Element, () => void>()
  for (const figure of document.querySelectorAll<HTMLElement>("[data-svg-scene]")) {
    const controls = figure.querySelector<HTMLFieldSetElement>("[data-scene-controls]")
    const seek = figure.querySelector<HTMLInputElement>("[data-seek]")
    const play = figure.querySelector<HTMLButtonElement>("[data-play]")
    const pause = figure.querySelector<HTMLButtonElement>("[data-pause]")
    const replay = figure.querySelector<HTMLButtonElement>("[data-replay]")
    const status = figure.querySelector<HTMLElement>("[data-playback-status]")
    if (!controls || !seek || !play || !pause || !replay || !status) continue
    const buttons = [...figure.querySelectorAll<HTMLButtonElement>("[data-select-state]")]
    const marks = [...figure.querySelectorAll<SVGElement>("[data-scene-mark]")]
    const duration = Number(seek.max)
    const supported = typeof Element.prototype.animate === "function"
    const animations = supported
      ? marks.map((mark, index) => {
          const start = index / marks.length
          const end = (index + 1) / marks.length
          const animation = mark.animate(
            [
              { opacity: index === 0 ? 1 : 0.35, offset: 0 },
              ...(index > 0 ? [{ opacity: 0.35, offset: (index - 0.15) / marks.length }] : []),
              { opacity: 1, offset: start },
              { opacity: 1, offset: (index + 0.85) / marks.length },
              { opacity: index === marks.length - 1 ? 1 : 0.35, offset: end },
              { opacity: index === marks.length - 1 ? 1 : 0.35, offset: 1 },
            ],
            { duration, fill: "both", easing: "linear" },
          )
          animation.pause()
          animation.currentTime = 0
          return animation
        })
      : []
    const lifetime = new AbortController()
    const options = { signal: lifetime.signal }
    let running = false
    let time = 0
    let frame = 0
    let selected = -1
    const canAnimate = () => supported && !reduced.matches && !printing.matches
    const update = () => {
      seek.value = String(time)
      const index = Math.min(buttons.length - 1, Math.floor(time / 1200))
      if (index !== selected) {
        selected = index
        for (const [position, button] of buttons.entries()) {
          button.setAttribute("aria-pressed", String(position === index))
        }
        figure.dataset["currentState"] = buttons[index]?.dataset["selectState"] ?? ""
      }
      play.disabled = !canAnimate() || running
      replay.disabled = !canAnimate()
      pause.disabled = !running
      figure.dataset["playback"] = running ? "playing" : "paused"
      const stateLabel = ` · ${index + 1} / ${buttons.length}`
      const message = !canAnimate()
        ? "Static mode / 静止表示"
        : running
          ? "Playing / 再生中"
          : "Paused / 一時停止"
      const text = message + stateLabel
      if (status.textContent !== text) status.textContent = text
      seek.setAttribute(
        "aria-valuetext",
        `${Math.round(time)} ms · ${index + 1} / ${buttons.length}`,
      )
    }
    const stop = () => {
      const current = animations[0]?.currentTime
      if (running && typeof current === "number") time = Math.min(duration, current)
      running = false
      cancelAnimationFrame(frame)
      for (const animation of animations) {
        if (canAnimate()) animation.pause()
        else animation.cancel()
      }
      update()
    }
    const setTime = (next: number) => {
      stop()
      time = Math.max(0, Math.min(duration, next))
      if (canAnimate()) for (const animation of animations) animation.currentTime = time
      update()
    }
    const tick = () => {
      const current = animations[0]?.currentTime
      if (typeof current === "number") time = Math.min(duration, current)
      if (time >= duration) {
        stop()
        return
      }
      update()
      frame = requestAnimationFrame(tick)
    }
    const start = () => {
      const bounds = figure.getBoundingClientRect()
      if (!canAnimate() || document.hidden || bounds.bottom <= 0 || bounds.top >= innerHeight)
        return
      if (time >= duration) setTime(0)
      running = true
      const now = document.timeline.currentTime
      for (const animation of animations) {
        animation.play()
        if (typeof now === "number") animation.startTime = now - time
      }
      update()
      frame = requestAnimationFrame(tick)
    }
    const preference = () => {
      stop()
      for (const animation of animations) {
        if (animation.effect)
          animation.effect.updateTiming({ fill: canAnimate() ? "both" : "none" })
        if (canAnimate()) animation.currentTime = time
      }
    }
    play.addEventListener("click", start, options)
    pause.addEventListener("click", stop, options)
    replay.addEventListener(
      "click",
      () => {
        setTime(0)
        start()
      },
      options,
    )
    seek.addEventListener(
      "input",
      () => {
        if (Number.isFinite(seek.valueAsNumber)) setTime(seek.valueAsNumber)
      },
      options,
    )
    for (const [index, button] of buttons.entries()) {
      button.addEventListener("click", () => setTime(index * 1200), options)
    }
    reduced.addEventListener("change", preference, options)
    printing.addEventListener("change", preference, options)
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) stop()
      },
      options,
    )
    window.addEventListener("pagehide", stop, options)
    window.addEventListener("beforeprint", stop, options)
    const observer = new IntersectionObserver((entries) => {
      if (entries.every((entry) => !entry.isIntersecting)) stop()
    })
    observer.observe(figure)
    controls.hidden = false
    preference()
    disposers.set(figure, () => {
      lifetime.abort()
      observer.disconnect()
      cancelAnimationFrame(frame)
      for (const animation of animations) animation.cancel()
    })
  }
  const removals = new MutationObserver(() => {
    for (const [figure, dispose] of disposers) {
      if (!figure.isConnected) {
        dispose()
        disposers.delete(figure)
      }
    }
  })
  removals.observe(document.body, { childList: true, subtree: true })
  return () => {
    removals.disconnect()
    for (const dispose of disposers.values()) dispose()
  }
}

mountSceneRuntime()
