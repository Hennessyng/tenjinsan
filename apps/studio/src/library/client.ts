import type { CatalogKey } from "@reading-studio/contracts/i18n"
import { createContext, useEffect, useRef, useState } from "react"
import { z } from "zod"
import { SourceRequestError, sourceCommand, sourceRequest } from "../source-viewer/client.ts"
import { type RoomId, roomPrerequisites } from "./room-map.ts"

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

class LibraryContextAdoption extends Event {
  constructor(readonly context: LibraryContext) {
    super("studio-library-context")
  }
}
export function adoptLibraryContext(context: LibraryContext): void {
  window.dispatchEvent(new LibraryContextAdoption(context))
}

export function readLibraryContext(signal: AbortSignal): Promise<LibraryContext> {
  return sourceRequest("/api/library-context", LibraryContext, signal)
}

export type LibraryLoadError =
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "retry" }

export function useLibraryContext(
  generation: string,
  active = true,
): {
  readonly context: LibraryContext | null
  readonly error: LibraryLoadError | null
  readonly ready: boolean
  readonly selectStudy: typeof selectLibraryStudy
} {
  const [state, setState] = useState<{
    readonly context: LibraryContext | null
    readonly error: LibraryLoadError | null
    readonly generation: string
  }>({ context: null, error: null, generation: "" })
  const current = useRef(generation)
  useEffect(() => {
    const adopt = (event: Event) => {
      if (!active || !(event instanceof LibraryContextAdoption)) return
      current.current = ""
      setState({ context: event.context, error: null, generation })
    }
    window.addEventListener("studio-library-context", adopt)
    return () => window.removeEventListener("studio-library-context", adopt)
  }, [active, generation])
  useEffect(() => {
    if (!active) {
      setState({ context: null, error: null, generation: "" })
      return
    }
    current.current = generation
    const abort = new AbortController()
    readLibraryContext(abort.signal)
      .then((context) => {
        if (!abort.signal.aborted && current.current === generation)
          setState({ context, error: null, generation })
      })
      .catch((failure: unknown) => {
        if (abort.signal.aborted || current.current !== generation) return
        if (!(failure instanceof Error)) throw failure
        setState((previous) => ({
          context: previous.context,
          generation: "",
          error:
            failure instanceof SourceRequestError
              ? { kind: "status", status: failure.status }
              : { kind: "retry" },
        }))
      })
    return () => abort.abort()
  }, [generation, active])
  return {
    context: state.context,
    error: state.error,
    ready: active && state.generation === generation,
    selectStudy: async (studyId) => {
      const selection = await selectLibraryStudy(studyId)
      setState((previous) =>
        previous.context === null
          ? previous
          : {
              ...previous,
              context: { ...previous.context, selectedStudyId: selection.selectedStudyId },
            },
      )
      return selection
    },
  }
}

export function selectLibraryStudy(
  studyId: string,
  signal?: AbortSignal,
): Promise<{ selectedStudyId: string }> {
  return sourceCommand(
    "/api/library-selection",
    { studyId },
    z.strictObject({ selectedStudyId: z.string() }),
    signal,
  )
}

export type RoomPrerequisite =
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "missing"; readonly next: RoomId; readonly message: CatalogKey }
  | { readonly kind: "unavailable"; readonly status: number }

async function inspectRoom(
  room: RoomId,
  study: LibraryStudy | null,
  signal: AbortSignal,
): Promise<RoomPrerequisite> {
  const missing = roomPrerequisites[room]
  if (missing === null) return { kind: "ready" }
  if (!study)
    return {
      kind: "missing",
      next: "accession",
      message: "room.missing.chooseStudy",
    }
  try {
    switch (room) {
      case "accession":
      case "bindery":
        return { kind: "ready" }
      case "lending":
        return study.normalizationId ? { kind: "ready" } : { kind: "missing", ...missing }
      case "reference":
        await sourceRequest(
          `/api/interviews/${study.id}`,
          z.object({ definition: z.object({ id: z.string() }) }),
          signal,
        )
        break
      case "reading":
        await sourceRequest(
          `/api/briefs/${study.id}`,
          z.object({ setup: z.object({ studyId: z.string() }) }),
          signal,
        )
        break
      case "catalogue": {
        const value = await sourceRequest(
          `/api/outlines/${study.id}`,
          z.object({ brief: z.object({ id: z.string() }).nullable() }),
          signal,
        )
        if (!value.brief) return { kind: "missing", ...missing }
        break
      }
      case "review":
        await sourceRequest(`/api/evidence/${study.id}`, z.object({ lessonId: z.string() }), signal)
        break
      case "ledger":
        await sourceRequest(
          `/api/revision-page/${study.id}`,
          z.object({ view: z.object({ setup: z.object({ id: z.string() }) }) }),
          signal,
        )
        break
      case "display": {
        const value = await sourceRequest(
          `/api/publications/${study.id}`,
          z.object({
            view: z.object({ ready: z.boolean() }).nullable(),
            history: z.array(z.object({ current: z.boolean() })),
          }),
          signal,
        )
        if (!value.view && value.history.length === 0) return { kind: "missing", ...missing }
        break
      }
    }
    return { kind: "ready" }
  } catch (failure) {
    if (signal.aborted) throw failure
    if (failure instanceof SourceRequestError)
      return failure.status === 404
        ? { kind: "missing", ...missing }
        : { kind: "unavailable", status: failure.status }
    if (failure instanceof TypeError || failure instanceof z.ZodError)
      return { kind: "unavailable", status: 500 }
    throw failure
  }
}

export function useRoomPrerequisite(room: RoomId, study: LibraryStudy | null): RoomPrerequisite {
  const [state, setState] = useState<RoomPrerequisite>({ kind: "loading" })
  const generation = `${room}:${study?.id ?? ""}:${study?.setupId ?? ""}`
  const current = useRef(generation)
  useEffect(() => {
    current.current = generation
    const abort = new AbortController()
    setState({ kind: "loading" })
    inspectRoom(room, study, abort.signal).then(
      (value) => {
        if (!abort.signal.aborted && current.current === generation) setState(value)
      },
      (failure: unknown) => {
        if (!abort.signal.aborted) throw failure
      },
    )
    return () => abort.abort()
  }, [generation, room, study])
  return roomPrerequisites[room] === null ? { kind: "ready" } : state
}
