import type { ReactElement } from "react"
import { useEffect, useRef, useState } from "react"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { SourceFrame } from "../source-viewer/SourceRoutes.tsx"
import type { Evidence, EvidenceAction } from "./client.ts"
import { EvidenceState, LatestLesson } from "./client.ts"
import { EvidenceSources } from "./EvidenceSources.tsx"
import { EvidenceValues } from "./EvidenceValues.tsx"
import "./review-room.css"

const labels = {
  support: "Support / 主張の裏付け",
  qualification: "Qualifications / 留保",
  translation: "Translation / 翻訳",
  visual: "Visual assumptions / 図解の仮定",
} as const

export function EvidenceRoutes(): ReactElement {
  const [, , study, lesson] = window.location.pathname.split("/")
  const endpoint = `/api/evidence/${encodeURIComponent(study ?? "")}/${encodeURIComponent(lesson ?? "")}`
  const [state, setState] = useState<Evidence | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState("")
  const alert = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    if (!lesson) {
      sourceRequest(
        `/api/evidence/${encodeURIComponent(study ?? "")}`,
        LatestLesson,
        controller.signal,
      ).then(
        ({ lessonId }) => window.location.assign(`/evidence/${study}/${lessonId}`),
        () => {
          if (!controller.signal.aborted) setError(true)
        },
      )
    } else {
      sourceRequest(endpoint, EvidenceState, controller.signal).then(
        setState,
        (failure: unknown) => {
          if (controller.signal.aborted) return
          if (failure instanceof SourceRequestError) setError(true)
          else throw failure
        },
      )
    }
    return () => controller.abort()
  }, [endpoint, lesson, study])
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  async function act(action: EvidenceAction): Promise<void> {
    if (!state) return
    setBusy(true)
    setError(false)
    try {
      setState(
        await sourceCommand(
          endpoint,
          { expectedId: state.view.draft.id, ...action },
          EvidenceState,
        ),
      )
      if (action.action === "private-detail") setDetail("")
    } catch (failure) {
      if (failure instanceof SourceRequestError) {
        setState(await sourceRequest(endpoint, EvidenceState, new AbortController().signal))
        setError(true)
      } else throw failure
    } finally {
      setBusy(false)
    }
  }
  if (!state)
    return (
      <SourceFrame>
        {error ? (
          <p role="alert">
            This lesson is outdated or unavailable. Review the current approved outline and lesson.
          </p>
        ) : (
          <p role="status">Loading evidence review</p>
        )}
      </SourceFrame>
    )
  const { view } = state
  const { draft, privacy } = view
  return (
    <SourceFrame>
      <section className="setup evidence evidence-review">
        <p className="eyebrow">REVIEW / BEFORE PUBLICATION</p>
        <h1>
          Evidence and privacy / <span lang="ja">根拠とプライバシー</span>
        </h1>
        <nav>
          <a href={`/outlines/${draft.studyId}`}>
            Study outline / <span lang="ja">学習の構成</span>
          </a>
        </nav>
        {error && (
          <p ref={alert} role="alert" tabIndex={-1}>
            Unable to proceed: stale review, invalid correction or unresolved privacy flag. /
            確認が古いか、修正が無効か、プライバシーの指摘が残っています。
          </p>
        )}
        <p className="review-stamp" role="status">
          {draft.keepPrivate
            ? "Kept private; publication blocked."
            : view.ready
              ? "Ready for later publication approval; not published."
              : "Review required; publication blocked."}
        </p>
        <p className="metadata">
          Lesson: {draft.lessonRevisionId}
          <br />
          Projection: {draft.projectionHash}
          <br />
          Report: {view.reportHash}
        </p>
        <section className="review-paper" aria-label="Source integrity review">
          <EvidenceSources value={state} />
        </section>
        <section className="review-paper" aria-labelledby="meaning-review-title">
          <h2 id="meaning-review-title">
            2. Meaning review / <span lang="ja">意味の確認</span>
          </h2>
          <div className="meaning-review">
            <p className="review-caution">
              Compare claims with source passages, retained caveats, both languages and visual
              assumptions. Correct or remove content below, or explicitly acknowledge uncertainty.
              Acknowledged does not mean verified. /{" "}
              <span lang="ja">
                主張・留保・両言語・図解の仮定を確認してください。不確実性の認識は、正しさの証明ではありません。
              </span>
            </p>
            <div className="meaning-decisions">
              {draft.semantic.map((decision) => (
                <section key={decision.category} aria-label={decision.category}>
                  <h3>{labels[decision.category]}</h3>
                  <p>State: {decision.status}</p>
                  <div className="setup-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void act({
                          action: "semantic",
                          category: decision.category,
                          status: "reviewed",
                        })
                      }}
                    >
                      Mark {decision.category} reviewed
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void act({
                          action: "semantic",
                          category: decision.category,
                          status: "acknowledged",
                        })
                      }}
                    >
                      Acknowledge {decision.category} uncertainty
                    </button>
                  </div>
                </section>
              ))}
            </div>
          </div>
        </section>
        <section className="review-paper" aria-labelledby="privacy-review-title">
          <h2 id="privacy-review-title">
            3. Privacy / <span lang="ja">プライバシー</span>
          </h2>
          <p>
            Screened {privacy.reviewedPaths.length} projected values. Screening assists review; it
            cannot guarantee anonymization. Inspect names, identifying situations and private source
            details in both languages. Privacy flags cannot be waived. /{" "}
            <span lang="ja">
              自動確認は匿名化を保証しません。個人を特定する情報を両言語で確認してください。指摘は免除できません。
            </span>
          </p>
          <ul>
            {privacy.findings.map((finding) => (
              <li role="alert" key={`${finding.path}-${finding.category}`}>
                {finding.category}:{" "}
                <a href="#projected-content">
                  <code>{finding.path}</code>
                </a>{" "}
                — remove or generalize / 削除または一般化
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void act({ action: "private-detail", text: detail })
            }}
          >
            <label htmlFor="private-detail">
              Known private detail or translated alias / 非公開情報・別言語での表記
            </label>
            <input
              id="private-detail"
              required
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              Add to screening
            </button>
          </form>
          <div className="setup-actions">
            <button
              type="button"
              disabled={busy || privacy.findings.length > 0}
              onClick={() => {
                void act({ action: "privacy-reviewed" })
              }}
            >
              Confirm privacy review of all projected content
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void act({ action: "keep-private" })
              }}
            >
              Keep private / 非公開のままにする
            </button>
          </div>
          <p>
            Privacy review: {privacy.status}. Every content change requires a new review. /{" "}
            <span lang="ja">内容の変更後は再確認が必要です。</span>
          </p>
        </section>
        <EvidenceValues
          value={state}
          onAction={(action) => {
            void act(action)
          }}
          busy={busy}
        />
      </section>
    </SourceFrame>
  )
}
