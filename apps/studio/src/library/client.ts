import { z } from "zod"
import { sourceCommand, sourceRequest } from "../source-viewer/client.ts"

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

export function selectLibraryStudy(studyId: string): Promise<{ selectedStudyId: string }> {
  return sourceCommand(
    "/api/library-selection",
    { studyId },
    z.strictObject({ selectedStudyId: z.string() }),
  )
}
