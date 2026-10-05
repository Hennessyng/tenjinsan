import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react"
import { authenticationRequiredEvent } from "../source-viewer/client.ts"

export function useAuthenticationRequired(): boolean {
  const [required, setRequired] = useState(false)
  useEffect(() => {
    const expired = () => setRequired(true)
    window.addEventListener(authenticationRequiredEvent, expired)
    return () => window.removeEventListener(authenticationRequiredEvent, expired)
  }, [])
  return required
}

export function AuthRequired(): ReactElement {
  const title = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    title.current?.focus()
  }, [])
  return (
    <main className="source-app">
      <section className="paper">
        <h1 ref={title} tabIndex={-1}>
          Authentication required / 再ログインが必要です
        </h1>
        <p>
          Your owner session expired. Sign in to return to the hall. No failed action will be
          repeated.
        </p>
        <p lang="ja">
          セッションが終了しました。ログインして広間に戻ってください。失敗した操作は繰り返しません。
        </p>
        <a href="/login">Sign in / ログイン</a>
      </section>
    </main>
  )
}
