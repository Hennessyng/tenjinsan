import { type ComponentProps, useState } from "react"
import { useLanguage } from "../i18n/LanguageProvider.tsx"
import { FullBookPreparation } from "./FullBookPreparation.tsx"
import { SetupReview } from "./SetupReview.tsx"

export function SetupModeReview(props: ComponentProps<typeof SetupReview>) {
  const { t } = useLanguage()
  const [experimental, setExperimental] = useState(false)
  const eligible =
    props.value.deployment === "local" &&
    props.value.setup.analysis.provider === "chatgpt-subscription" &&
    !props.value.preparation?.purpose
  if (!eligible) return <SetupReview {...props} />
  return (
    <>
      <section className="setup">
        <label>
          {t("fullBook.mode")}
          <select
            value={experimental ? "full-book-test-1" : ""}
            disabled={props.busy}
            onChange={(event) => setExperimental(event.target.value === "full-book-test-1")}
          >
            <option value="">{t("fullBook.savedMode")}</option>
            <option value="full-book-test-1">{t("fullBook.experimental")}</option>
          </select>
        </label>
      </section>
      {experimental ? (
        <FullBookPreparation
          key={props.value.setup.id}
          setupId={props.value.setup.id}
          onCancel={() => setExperimental(false)}
        />
      ) : (
        <SetupReview {...props} />
      )}
    </>
  )
}
