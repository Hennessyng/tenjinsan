import {
  createElement,
  type ReactElement,
  type SyntheticEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { z } from "zod"

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
const baselines = new Map<Control, string>()
const initial = new Map<Control, string>()
const NavigationState = z.object({ libraryIndex: z.number().int() })
let index = 0

class DepartureRequest extends Event {
  constructor(readonly action: () => void) {
    super("studio-departure")
  }
}

function controls(root: ParentNode): Control[] {
  return Array.from(root.querySelectorAll<Control>("input:not([type=hidden]), textarea, select"))
}

function value(control: Control): string {
  if (control instanceof HTMLInputElement) {
    if (control.type === "checkbox" || control.type === "radio")
      return `${control.value}:${control.checked}`
    if (control.type === "file")
      return JSON.stringify(
        Array.from(control.files ?? []).map((file) => [file.name, file.size, file.lastModified]),
      )
  }
  return control.value
}

function dirty(): boolean {
  let changed = false
  for (const [control, baseline] of baselines) {
    if (!control.isConnected) {
      baselines.delete(control)
      initial.delete(control)
    } else if (value(control) !== baseline) changed = true
  }
  return changed
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (dirty()) {
    event.preventDefault()
    event.returnValue = ""
  }
}

function synchronize(): void {
  if (dirty()) window.addEventListener("beforeunload", beforeUnload)
  else window.removeEventListener("beforeunload", beforeUnload)
}

export function captureEditSave(): (reset?: boolean) => void {
  const form = document.activeElement?.closest("form")
  const saved = new Map(
    form ? controls(form).map((control) => [control, value(control)] as const) : [],
  )
  return (reset = false) => {
    for (const [control, snapshot] of saved)
      baselines.set(control, reset ? (initial.get(control) ?? snapshot) : snapshot)
    synchronize()
  }
}

export function requestDeparture(action: () => void): void {
  if (dirty()) window.dispatchEvent(new DepartureRequest(action))
  else action()
}

export function commitRoomNavigation(target: URL): void {
  index += 1
  history.pushState({ libraryIndex: index }, "", target)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

export function useUnsavedEdits(): void {
  useLayoutEffect(() => {
    const state = NavigationState.safeParse(history.state)
    index = state.success ? state.data.libraryIndex : 0
    history.replaceState({ libraryIndex: index }, "", location.href)
    const scan = () => {
      const root = document.querySelector("#desk .sheet")
      if (root)
        for (const control of controls(root)) {
          if (!baselines.has(control)) {
            const snapshot = value(control)
            baselines.set(control, snapshot)
            initial.set(control, snapshot)
          }
        }
      synchronize()
    }
    const rootElement = document.getElementById("root")
    if (rootElement === null) throw new TypeError("Studio root element is missing")
    const observer = new MutationObserver(scan)
    observer.observe(rootElement, {
      childList: true,
      subtree: true,
    })
    scan()
    document.addEventListener("input", synchronize)
    document.addEventListener("change", synchronize)
    const links = (event: MouseEvent) => {
      if (
        !dirty() ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("#library a[href]")
          : null
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.hasAttribute("data-source-open")
      )
        return
      const target = new URL(anchor.href)
      if (
        target.origin !== location.origin ||
        target.pathname.startsWith("/publication-artifacts/") ||
        (target.pathname === location.pathname && target.search === location.search && target.hash)
      )
        return
      event.preventDefault()
      event.stopPropagation()
      requestDeparture(() => location.assign(target))
    }
    let reversing = false
    let previous = location.href
    const back = (event: PopStateEvent) => {
      if (reversing) {
        reversing = false
        event.stopImmediatePropagation()
        return
      }
      const target = NavigationState.safeParse(history.state)
      const targetIndex = target.success ? target.data.libraryIndex : index
      if (dirty()) {
        event.stopImmediatePropagation()
        const delta = targetIndex - index
        if (delta !== 0) {
          reversing = true
          history.go(-delta)
          requestDeparture(() => history.go(delta))
        } else {
          const href = location.href
          history.replaceState({ libraryIndex: index }, "", previous)
          requestDeparture(() => commitRoomNavigation(new URL(href)))
        }
        return
      }
      index = targetIndex
      previous = location.href
    }
    document.addEventListener("click", links, true)
    window.addEventListener("popstate", back, true)
    return () => {
      observer.disconnect()
      document.removeEventListener("input", synchronize)
      document.removeEventListener("change", synchronize)
      document.removeEventListener("click", links, true)
      window.removeEventListener("popstate", back, true)
      window.removeEventListener("beforeunload", beforeUnload)
      baselines.clear()
      initial.clear()
    }
  }, [])
}

export function UnsavedDepartureDialog({
  text,
}: {
  readonly text: {
    readonly title: string
    readonly body: string
    readonly stay: string
    readonly leave: string
  }
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const [pending, setPending] = useState<(() => void) | null>(null)
  useEffect(() => {
    const receive = (event: Event) => {
      if (event instanceof DepartureRequest) setPending((current) => current ?? event.action)
    }
    window.addEventListener("studio-departure", receive)
    return () => window.removeEventListener("studio-departure", receive)
  }, [])
  useEffect(() => {
    if (pending) dialog.current?.showModal()
    else dialog.current?.close()
  }, [pending])
  const stay = () => setPending(null)
  const leave = () => {
    const action = pending
    setPending(null)
    baselines.clear()
    initial.clear()
    synchronize()
    dialog.current?.close()
    action?.()
  }
  return createElement(
    "dialog",
    {
      ref: dialog,
      className: "departure-dialog",
      "aria-labelledby": "departure-title",
      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault()
        stay()
      },
    },
    createElement("h2", { id: "departure-title" }, text.title),
    createElement("p", null, text.body),
    createElement(
      "div",
      { className: "departure-actions" },
      createElement(
        "button",
        { type: "button", className: "btn btn-quiet", onClick: stay, autoFocus: true },
        text.stay,
      ),
      createElement(
        "button",
        { type: "button", className: "btn btn-primary", onClick: leave },
        text.leave,
      ),
    ),
  )
}
