import type { PortableLayout } from './workbench/portable.ts'

type Refusal = { ok: false; error: string }
export type PortableImport = { ok: true; recipe: PortableLayout | null } | Refusal
export type PortableExport = { ok: true; canceled: boolean } | (Refusal & { unconfirmed?: boolean })
export interface PortableLayoutBridge {
  importFile(): Promise<PortableImport>
  exportFile(recipeText: string): Promise<PortableExport>
}
