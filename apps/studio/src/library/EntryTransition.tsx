import { type ReactElement, type ReactNode, useLayoutEffect, useRef, useState } from "react"
import { decorateGate, gateArtwork } from "./gate-artwork.ts"

export function EntryTransition({ children }: { readonly children: ReactNode }): ReactElement {
  const [phase, setPhase] = useState<"rest" | "entering" | "done">(() =>
    window.location.pathname === "/" && document.cookie.split("; ").includes("tj_entry=1")
      ? "rest"
      : "done",
  )
  const gate = useRef<HTMLDivElement>(null)
  const workspace = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (phase === "done") return
    document.cookie = `tj_entry=; Path=/; Max-Age=0; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`
    const scene = gate.current?.querySelector<HTMLDivElement>(".gate-scene")
    if (scene) {
      scene.innerHTML = gateArtwork
      decorateGate(scene)
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
    const arrive = () => {
      setPhase("done")
    }
    if (reduce.matches) {
      arrive()
      return
    }
    const frame = requestAnimationFrame(() => setPhase("entering"))
    const timer = window.setTimeout(arrive, 1500)
    reduce.addEventListener("change", arrive, { once: true })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      reduce.removeEventListener("change", arrive)
    }
  }, [phase])
  const arrived = useRef(false)
  useLayoutEffect(() => {
    if (phase !== "done") {
      arrived.current = true
      return
    }
    if (arrived.current) workspace.current?.querySelector<HTMLAnchorElement>("nav a")?.focus()
  }, [phase])
  return (
    <>
      <div ref={workspace} inert={phase !== "done"}>
        {children}
      </div>
      {phase !== "done" && (
        <div
          ref={gate}
          className={`library-entrance gate${phase === "entering" ? " is-entering is-leaving" : ""}`}
          role="status"
          aria-label="Entering the library"
        >
          <div className="gate-scene" aria-hidden="true" />
        </div>
      )}
    </>
  )
}
