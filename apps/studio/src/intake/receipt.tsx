import { createContext, type ReactElement, type ReactNode, useContext, useState } from "react"
import { z } from "zod"

export const Receipt = z.object({
  id: z.string(),
  state: z.literal("queued"),
  bytes: z.number().int().nonnegative(),
  normalizationRevisionId: z.string().optional(),
})
type ReceiptState = ReturnType<typeof useReceiptState>
const ImportReceipt = createContext<ReceiptState | null>(null)
function useReceiptState() {
  return useState<z.infer<typeof Receipt> | null>(null)
}
export function useImportReceipt(): ReceiptState {
  const shared = useContext(ImportReceipt)
  const local = useReceiptState()
  return shared ?? local
}
export function ImportReceiptProvider({
  children,
}: {
  readonly children: ReactNode
}): ReactElement {
  const state = useReceiptState()
  return <ImportReceipt value={state}>{children}</ImportReceipt>
}
