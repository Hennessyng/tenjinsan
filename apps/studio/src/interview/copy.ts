import { translate, type UiLocale } from "@reading-studio/contracts/i18n"

function copyFor(locale: UiLocale) {
  return {
    title: translate(locale, "interview.title"),
    intro: translate(locale, "interview.intro"),
    progress: translate(locale, "interview.progress"),
    of: translate(locale, "interview.of"),
    suggested: translate(locale, "interview.suggested"),
    browse: translate(locale, "interview.browse"),
    review: translate(locale, "interview.review"),
    save: translate(locale, "interview.save"),
    custom: translate(locale, "interview.custom"),
    saveCustom: translate(locale, "interview.saveCustom"),
    unsure: translate(locale, "interview.unsure"),
    skip: translate(locale, "interview.skip"),
    back: translate(locale, "interview.back"),
    next: translate(locale, "interview.next"),
    edit: translate(locale, "interview.edit"),
    saved: translate(locale, "interview.saved"),
    hint: translate(locale, "interview.hint"),
    required: translate(locale, "interview.required"),
    range: translate(locale, "interview.range"),
    to: translate(locale, "interview.to"),
    choices: translate(locale, "interview.choices"),
    empty: translate(locale, "interview.empty"),
    customSaved: translate(locale, "interview.customSaved"),
    skipped: translate(locale, "interview.skipped"),
    error: translate(locale, "interview.error"),
    complete: translate(locale, "interview.complete"),
    pending: translate(locale, "interview.pending"),
    return: translate(locale, "interview.return"),
  }
}

export const interviewCopy = { en: copyFor("en"), ja: copyFor("ja") }
export type InterviewLanguage = keyof typeof interviewCopy
