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
    <a href={`${href}${window.location.search}`} aria-current={roomCurrent(href)}>
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
    <div className="library-workspace library-route">
      <a
        className="skip-link"
        href={window.location.pathname === "/imports" ? "#studio" : "#reading"}
      >
        Skip to the studio <span lang="ja">読書スタジオへ</span>
      </a>
      <header className="library-lockup">
        <a className="brand" href="/">
          <svg aria-hidden="true" className="library-crest" viewBox="-50 -50 100 100">
            {[0, 72, 144, 216, 288].map((angle) => (
              <circle key={angle} cx="0" cy="-26" r="17" transform={`rotate(${angle})`} />
            ))}
            <circle cx="0" cy="0" r="4" />
          </svg>
          <span>
            TENJINSAN<small lang="ja">問いからひらく読書</small>
          </span>
        </a>
        <span>
          Personal library <span lang="ja">私の図書室</span>
        </span>
      </header>
      <WorkspaceNavigation />
      {window.location.pathname === "/imports" ? <main id="studio">{page}</main> : page}
    </div>
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
  if (/^\/outlines\/[^/]+$/.test(window.location.pathname))
    return withNavigation(authoringRoute(<OutlineRoutes />))
  if (/^\/briefs\/[^/]+$/.test(window.location.pathname))
    return withNavigation(authoringRoute(<BriefRoutes />))
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
    <div className="studio-shell library-workspace min-h-dvh">
      <a className="skip-link" href="#studio">
        Skip to the studio <span lang="ja">読書スタジオへ</span>
      </a>
      <header className="site-header">
        <a className="brand" href="#studio" aria-label="Reading studio home / 読書スタジオ ホーム">
          <svg className="library-crest" viewBox="-50 -50 100 100" aria-hidden="true">
            {[0, 72, 144, 216, 288].map((angle) => (
              <circle key={angle} cx="0" cy="-26" r="17" transform={`rotate(${angle})`} />
            ))}
            <circle cx="0" cy="0" r="4" />
          </svg>
          <span>
            TENJINSAN / READING STUDIO
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

          <figure className="conversation-mark library-hall">
            <svg
              viewBox="0 0 560 480"
              role="img"
              aria-labelledby="conversation-title conversation-description"
            >
              <title id="conversation-title">A quiet personal library</title>
              <desc id="conversation-description">
                Timber bookshelves and a reading table in a green-walled room. 静かな図書室。
              </desc>
              <path className="hall-wall" d="M30 40h500v270H30z" />
              <path className="hall-floor" d="M30 310h500l30 140H0z" />
              <path className="hall-timber" d="M50 60h220v250H50z" />
              {[100, 170, 240].map((height) => (
                <g key={height}>
                  <path className="hall-shelf" d={`M60 ${height}h200v10H60z`} />
                  {[70, 110, 150, 190, 230].map((position) => (
                    <rect
                      key={position}
                      className="hall-book"
                      x={position}
                      y={height - 48}
                      width="26"
                      height="48"
                      rx="2"
                    />
                  ))}
                </g>
              ))}
              <path className="hall-window" d="M340 90q60-65 120 0v150H340z" />
              <path
                className="hall-table"
                d="M170 300h250l30 60H140zM170 360h16v60h-16zM404 360h16v60h-16z"
              />
              <path className="hall-paper" d="m240 310 45 10 45-10 15 30-60 10-60-10z" />
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
