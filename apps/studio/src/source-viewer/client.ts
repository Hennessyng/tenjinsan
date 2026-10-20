import {
  BookEdition,
  NormalizationRevision,
  SourcePreparationFailure,
  SourceSpan,
} from "@reading-studio/contracts/source"
import { z } from "zod"

export const Library = z.strictObject({
  documents: z.array(
    z.strictObject({ edition: BookEdition, normalization: NormalizationRevision }),
  ),
  pending: z.array(z.strictObject({ id: z.string(), bytes: z.number().int().nonnegative() })),
})
export const Reader = z.strictObject({
  edition: BookEdition,
  normalization: NormalizationRevision,
  chapter: z.number().int().nonnegative(),
  span: SourceSpan.nullable(),
})

export class SourceRequestError extends Error {
  constructor(readonly status: number) {
    super(`Source request failed (${status})`)
  }
}
export class SourcePreparationError extends SourceRequestError {
  constructor(readonly failure: SourcePreparationFailure) {
    super(422)
  }
}

export async function sourceRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal })
  if (!response.ok) {
    throw new SourceRequestError(response.status)
  }
  return schema.parse(await response.json())
}

export async function sourceCommand<T>(
  path: string,
  payload: unknown,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) {
    if (response.status === 422) {
      const failure = SourcePreparationFailure.safeParse(await response.json())
      if (failure.success) throw new SourcePreparationError(failure.data)
    }
    throw new SourceRequestError(response.status)
  }
  return schema.parse(await response.json())
}
