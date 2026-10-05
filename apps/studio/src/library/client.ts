import { createContext, useEffect, useRef, useState } from "react"
import { z } from "zod"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"

export const LibraryStudy = z
  .strictObject({
    id: z.string(),
    editionId: z.string(),
    title: z.string(),
    normalizationId: z.string().nullable(),
    normalizations: z.array(z.string()),
    setupId: z.string().nullable(),
  })
  .readonly()
export type LibraryStudy = z.infer<typeof LibraryStudy>
export const SelectedLibraryStudy = createContext<LibraryStudy | null | undefined>(undefined)
export const LibraryContext = z
  .strictObject({
    studies: z.array(LibraryStudy).readonly(),
    selectedStudyId: z.string().nullable(),
  })
  .readonly()
export type LibraryContext = z.infer<typeof LibraryContext>

export function readLibraryContext(signal: AbortSignal): Promise<LibraryContext> {
  return sourceRequest("/api/library-context", LibraryContext, signal)
}

export function useLibraryContext(generation: string): {
  readonly context: LibraryContext | null
  readonly error: string
} {
  const [state, setState] = useState<{
    readonly context: LibraryContext | null
    readonly error: string
  }>({ context: null, error: "" })
  const current = useRef(generation)
  useEffect(() => {
    current.current = generation
    const abort = new AbortController()
    readLibraryContext(abort.signal)
      .then((context) => {
        if (!abort.signal.aborted && current.current === generation)
          setState({ context, error: "" })
      })
      .catch((failure: unknown) => {
        if (abort.signal.aborted || current.current !== generation) return
        if (!(failure instanceof Error)) throw failure
        setState((previous) => ({
          context: previous.context,
          error:
            failure instanceof SourceRequestError
              ? `Library unavailable (${failure.status}). / 図書室を読み込めません。`
              : "Library unavailable. Please retry. / もう一度お試しください。",
        }))
      })
    return () => abort.abort()
  }, [generation])
  return state
}

export function selectLibraryStudy(studyId: string): Promise<{ selectedStudyId: string }> {
  return sourceCommand(
    "/api/library-selection",
    { studyId },
    z.strictObject({ selectedStudyId: z.string() }),
  )
}
