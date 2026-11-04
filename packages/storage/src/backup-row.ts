import { z } from "zod"
export const Cell = z.union([z.string(), z.number().int().safe(), z.null()])
export const Row = z.record(z.string(), Cell)
export type Row = z.infer<typeof Row>
