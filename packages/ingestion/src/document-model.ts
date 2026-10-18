import type { SourceBlock } from "@reading-studio/contracts"
import type { z } from "zod"

export type DocumentBlock = Omit<z.infer<typeof SourceBlock>, "id"> & { readonly fragment?: string }
export type ExtractedDocument = {
  readonly chapters: readonly {
    readonly path: string
    readonly role: "main-chapter" | "supplementary"
    readonly blocks: readonly DocumentBlock[]
  }[]
  readonly skipped: readonly {
    readonly path: string
    readonly role?: "main-chapter" | "supplementary"
    readonly reason: string
  }[]
  readonly coverage: "complete" | "partial"
  readonly pages: readonly {
    readonly path: string
    readonly fragment?: string
    readonly label: string
  }[]
}
