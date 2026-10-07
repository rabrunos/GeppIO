import { decodeLayout } from './layout.ts'
import type { LayoutSnapshot, MinSize } from './layout.ts'
export interface LayoutStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function readLayout(storage: LayoutStorage, key: string, fallback: LayoutSnapshot, minimums: Readonly<Record<string, MinSize>>) {
  try {
    const raw = storage.getItem(key)
    return { snapshot: raw ? decodeLayout(raw, fallback.placements.map(p => p.id), minimums) : structuredClone(fallback), error: null }
  } catch {
    // Never erase or replace a malformed/old draft just because reading it failed.
    return { snapshot: structuredClone(fallback), error: 'Não foi possível restaurar o layout. O rascunho anterior não foi apagado.' }
  }
}
export function writeLayout(storage: LayoutStorage, key: string, snapshot: LayoutSnapshot): string | null {
  try { storage.setItem(key, JSON.stringify(snapshot)); return null }
  catch { return 'Não foi possível salvar localmente. As alterações continuam na sessão, mas não serão recuperadas ao reabrir.' }
}
