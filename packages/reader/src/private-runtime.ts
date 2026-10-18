;(() => {
  const controls = document.getElementById("private-language-controls")
  const dialog = document.getElementById("private-language-dialog")
  const notice = document.getElementById("private-language-notice")
  const key = controls?.dataset["storageKey"]
  if (!controls || !(dialog instanceof HTMLDialogElement) || !notice || !key) return
  const parse = (value: string | null | undefined) =>
    value === "en" || value === "ja" ? value : null
  const read = () => {
    try {
      return parse(localStorage.getItem(key))
    } catch (error) {
      if (!(error instanceof Error)) throw error
      console.warn("[ui-language] private reader storage read failed", error)
      return null
    }
  }
  const remember = (locale: "en" | "ja") => {
    try {
      localStorage.setItem(key, locale)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      console.warn("[ui-language] private reader storage write failed", error)
      notice.hidden = false
    }
  }
  const url = new URL(location.href)
  const explicit = parse(url.searchParams.get("lang"))
  const effective = explicit ?? read() ?? "en"
  if (explicit) remember(explicit)
  if (effective !== document.documentElement.lang) {
    url.searchParams.set("lang", effective)
    location.replace(url.href)
    return
  }
  let pending: (() => void) | null = null
  let opener: HTMLElement | null = null
  const stay = () => {
    pending = null
    dialog.close()
    opener?.focus()
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault()
    stay()
  })
  dialog.querySelector("[data-stay]")?.addEventListener("click", stay)
  dialog.querySelector("[data-leave]")?.addEventListener("click", () => {
    const action = pending
    pending = null
    dialog.close()
    action?.()
  })
  for (const button of controls.querySelectorAll<HTMLButtonElement>("[data-private-locale]")) {
    button.addEventListener("click", () => {
      const next = parse(button.dataset["privateLocale"])
      if (!next || next === effective) return
      const apply = () => {
        remember(next)
        const target = new URL(location.href)
        target.searchParams.set("lang", next)
        location.assign(target.href)
      }
      if (
        [...document.querySelectorAll<HTMLTextAreaElement>(".practice textarea")].some(
          (field) => field.value !== "",
        )
      ) {
        pending = apply
        opener = button
        dialog.showModal()
      } else apply()
    })
  }
})()
