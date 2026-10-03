import type { ReactElement } from "react"
import { lazy, Suspense } from "react"
import { ImportBook } from "./intake/ImportBook.tsx"

const BriefRoutes = lazy(() =>
  import("./brief/BriefRoutes.tsx").then(({ BriefRoutes }) => ({ default: BriefRoutes })),
)
const JobRoutes = lazy(() =>
  import("./jobs/JobRoutes.tsx").then(({ JobRoutes }) => ({ default: JobRoutes })),
)
const EvidenceRoutes = lazy(() =>
  import("./evidence/EvidenceRoutes.tsx").then(({ EvidenceRoutes }) => ({
    default: EvidenceRoutes,
  })),
)
const InterviewRoutes = lazy(() =>
  import("./interview/InterviewRoutes.tsx").then(({ InterviewRoutes }) => ({
    default: InterviewRoutes,
  })),
)
const OutlineRoutes = lazy(() =>
  import("./outline/OutlineRoutes.tsx").then(({ OutlineRoutes }) => ({ default: OutlineRoutes })),
)
const PublicationRoutes = lazy(() =>
  import("./publication/PublicationRoutes.tsx").then(({ PublicationRoutes }) => ({
    default: PublicationRoutes,
  })),
)
const RevisionRoutes = lazy(() =>
  import("./revisions/RevisionRoutes.tsx").then(({ RevisionRoutes }) => ({
    default: RevisionRoutes,
  })),
)
const SourceRoutes = lazy(() =>
  import("./source-viewer/SourceRoutes.tsx").then(({ SourceRoutes }) => ({
    default: SourceRoutes,
  })),
)
const SetupRoutes = lazy(() =>
  import("./study-setup/SetupRoutes.tsx").then(({ SetupRoutes }) => ({ default: SetupRoutes })),
)

function authoringRoute(page: ReactElement): ReactElement {
  return <Suspense fallback={<p role="status">Loading studio</p>}>{page}</Suspense>
}

const rooms = [
  { name: "Import a book", japanese: "本を追加", href: "/imports" },
  { name: "Your sources", japanese: "資料一覧", href: "/sources" },
  { name: "Reading interviews", japanese: "読書の質問", href: "/interviews" },
  { name: "Study progress", japanese: "学習の進行状況", href: "/jobs" },
] as const

function roomCurrent(href: string): "page" | undefined {
  const path = window.location.pathname
  if (path === href || path.startsWith(`${href}/`)) return "page"
  return undefined
}

function RoomLink({
  name,
  japanese,
  href,
}: {
  name: string
  japanese: string
  href: string
}): ReactElement {
  return (
    <a href={href} aria-current={roomCurrent(href)}>
      {name} / <span lang="ja">{japanese}</span>
    </a>
  )
}

function WorkspaceNavigation(): ReactElement {
  return (
    <nav aria-label="Workspace rooms" className="workspace-rooms">
      <div className="workspace-links">
        {rooms.map((room) => (
          <RoomLink key={room.href} {...room} />
        ))}
      </div>
      <details className="workspace-menu">
        <summary>
          Rooms <span lang="ja">部屋</span>
        </summary>
        <ul>
          {rooms.map((room) => (
            <li key={room.href}>
              <RoomLink {...room} />
            </li>
          ))}
        </ul>
      </details>
    </nav>
  )
}

function withNavigation(page: ReactElement): ReactElement {
  return (
    <>
      <WorkspaceNavigation />
      {page}
    </>
  )
}

export function App(): ReactElement {
  if (window.location.pathname === "/jobs") return withNavigation(authoringRoute(<JobRoutes />))
  if (window.location.pathname === "/imports") return withNavigation(<ImportBook />)
  if (/^\/publications\/[^/]+$/.test(window.location.pathname))
    return withNavigation(authoringRoute(<PublicationRoutes />))
  if (/^\/evidence\/[^/]+(?:\/[^/]+)?$/.test(window.location.pathname))
    return withNavigation(authoringRoute(<EvidenceRoutes />))
  if (/^\/revisions\/[^/]+$/.test(window.location.pathname))
    return withNavigation(authoringRoute(<RevisionRoutes />))
  if (/^\/outlines\/[^/]+$/.test(window.location.pathname)) return withNavigation(authoringRoute(<OutlineRoutes />))
  if (/^\/briefs\/[^/]+$/.test(window.location.pathname)) return withNavigation(authoringRoute(<BriefRoutes />))
  if (
    window.location.pathname === "/interviews" ||
    /^\/interviews\/[^/]+$/.test(window.location.pathname)
  )
    return withNavigation(authoringRoute(<InterviewRoutes />))
  if (/^\/sources\/[^/]+\/setup(?:\/[^/]+)?$/.test(window.location.pathname))
    return withNavigation(authoringRoute(<SetupRoutes />))
  if (
    window.location.pathname === "/sources" ||
    /^\/sources\/[^/]+$/.test(window.location.pathname)
  )
    return withNavigation(authoringRoute(<SourceRoutes />))
  return (
    <div className="studio-shell min-h-dvh">
      <a className="skip-link" href="#studio">
        Skip to the studio <span lang="ja">読書スタジオへ</span>
      </a>
      <header className="site-header">
        <a className="brand" href="#studio" aria-label="Reading studio home / 読書スタジオ ホーム">
          <svg className="brand-mark" viewBox="0 0 48 32" aria-hidden="true">
            <circle cx="18" cy="16" r="12" />
            <circle cx="30" cy="16" r="12" />
          </svg>
          <span>
            READING STUDIO
            <small lang="ja">問いからひらく読書</small>
          </span>
        </a>
        <span className="privacy-note">
          Personal workspace
          <small lang="ja">個人用ワークスペース</small>
        </span>
        <form action="/logout" method="post" className="owner-logout">
          <button type="submit">Log out</button>
        </form>
      </header>

      <WorkspaceNavigation />
      <main id="studio">
        <section className="hero" aria-labelledby="studio-title">
          <div className="hero-copy">
            <p className="eyebrow">
              A QUIET PLACE TO BEGIN <span aria-hidden="true">/</span>{" "}
              <span lang="ja">読む前の、静かな場所</span>
            </p>
            <h1 id="studio-title">
              Question-led
              <br />
              reading <em>studio.</em>
            </h1>
            <p className="hero-ja" lang="ja">
              問いからひらく、
              <br />
              <span className="no-break">あなただけの読書スタジオ。</span>
            </p>
            <div className="language-pair">
              <p lang="en">
                A private foundation for shaping a question and reading with attention.
              </p>
              <p lang="ja">
                問いを整え、丁寧に読むための、
                <span className="no-break">個人用の土台です。</span>
              </p>
            </div>
            <a className="text-link" href="#baseline">
              About this foundation <span lang="ja">この土台について</span>
              <span aria-hidden="true">↓</span>
            </a>
          </div>

          <figure className="conversation-mark">
            <svg
              viewBox="0 0 560 480"
              role="img"
              aria-labelledby="conversation-title conversation-description"
            >
              <title id="conversation-title">Two reading perspectives meeting</title>
              <desc id="conversation-description">
                Green and coral forms meet around a shared question. ふたつの視点が問いを囲む図。
              </desc>
              <circle className="orbit orbit-outer" cx="280" cy="240" r="188" />
              <circle className="orbit orbit-inner" cx="280" cy="240" r="132" />
              <path className="path path-green" d="M128 250 C170 94 378 82 431 232" />
              <path className="path path-coral" d="M432 259 C378 407 176 405 126 274" />
              <circle className="person person-green" cx="150" cy="258" r="72" />
              <circle className="person person-coral" cx="410" cy="258" r="72" />
              <circle className="question" cx="280" cy="240" r="49" />
              <text x="280" y="255" textAnchor="middle">
                ?
              </text>
            </svg>
            <figcaption>
              One question, two inner worlds.
              <span lang="ja">ひとつの問い、ふたつの内面。</span>
            </figcaption>
          </figure>
        </section>

        <ImportBook />
        <p>
          <a className="text-link" href="/jobs">
            Study progress / <span lang="ja">学習の進行状況</span>
          </a>
        </p>

        <section className="baseline" id="baseline" aria-labelledby="baseline-title">
          <p className="section-number">01 / FOUNDATION</p>
          <div>
            <h2 id="baseline-title">Small, private, and intentionally still.</h2>
            <p lang="ja" className="baseline-ja">
              小さく、個人的で、意図的に<span className="no-break">静かな土台。</span>
            </p>
          </div>
          <div className="language-pair baseline-copy">
            <p lang="en">
              Your private library begins with an EPUB. Review its source text and decide what, if
              anything, to share with a provider in the next step.
            </p>
            <p lang="ja">
              EPUBを追加して資料を確認できます。外部のプロバイダーに送る範囲は、別の手順でご自身が選びます。
            </p>
          </div>
        </section>
      </main>

      <footer>
        <span>Static by default.</span>
        <span lang="ja">最初から、静的に。</span>
      </footer>
    </div>
  )
}
