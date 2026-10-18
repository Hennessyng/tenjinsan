import type { ReactElement } from "react"
import { lazy, Suspense } from "react"
import { LanguageProvider, useLanguage } from "./i18n/LanguageProvider.tsx"
import { ImportBook } from "./intake/ImportBook.tsx"
import { LibraryShell } from "./library/LibraryShell.tsx"

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

function LoadingStudio(): ReactElement {
  const { t } = useLanguage()
  return (
    <main id="reading" tabIndex={-1}>
      <h1>{t("app.loadingStudio")}</h1>
      <p className="workspace-loading" role="status">
        {t("app.loadingStudio")}
      </p>
    </main>
  )
}

function WorkspaceApp(): ReactElement {
  const { t } = useLanguage()
  const path = window.location.pathname
  if (path === "/imports")
    return (
      <main id="studio" tabIndex={-1}>
        <ImportBook />
      </main>
    )
  if (path === "/jobs") return <JobRoutes />
  if (/^\/publications\/[^/]+$/.test(path)) return <PublicationRoutes />
  if (/^\/evidence\/[^/]+(?:\/[^/]+)?$/.test(path)) return <EvidenceRoutes />
  if (/^\/revisions\/[^/]+$/.test(path)) return <RevisionRoutes />
  if (/^\/outlines\/[^/]+$/.test(path)) return <OutlineRoutes />
  if (/^\/briefs\/[^/]+$/.test(path)) return <BriefRoutes />
  if (path === "/interviews" || /^\/interviews\/[^/]+$/.test(path)) return <InterviewRoutes />
  if (/^\/sources\/[^/]+\/setup(?:\/[^/]+)?$/.test(path)) return <SetupRoutes />
  if (path === "/sources" || /^\/sources\/[^/]+$/.test(path)) return <SourceRoutes />
  return <p>{t("app.selectRoom")}</p>
}

export function App(): ReactElement {
  return (
    <LanguageProvider>
      <LibraryShell>
        {() => (
          <Suspense fallback={<LoadingStudio />}>
            <WorkspaceApp key={window.location.href} />
          </Suspense>
        )}
      </LibraryShell>
    </LanguageProvider>
  )
}
